import { ipcMain } from "electron";

import { FORMAT_CHUNK_CHARS, OLLAMA_MODEL } from "../config.js";
import { FormatCancelled, ollama, streamChat } from "../ollama.js";
import { buildSystemPrompt } from "../prompts.js";
import { chunkText, stripConversational } from "../text-utils.js";
import {
  WEB_SEARCH_TOOL,
  executeToolCall,
  formatPreSearchBlock,
  preSearchFromContext,
} from "../web-search.js";
import { beginRun, cancelActiveRun, endRun } from "./active-run.js";

export function registerFormatHandlers() {
  // Cancel the in-flight format or image-placement run: flag the active token
  // (checked between stages and inside the stream loop) and abort the live
  // Ollama stream so a long generation stops immediately. Shared with placement.
  ipcMain.handle("llm:cancel-format", cancelActiveRun);

  ipcMain.handle("llm:format", handleFormat);

  ipcMain.handle("llm:check", async () => {
    try {
      const models = await ollama.list();
      const has = models.models?.some((model) =>
        model.name.startsWith(OLLAMA_MODEL),
      );
      return { ok: true, hasModel: !!has, model: OLLAMA_MODEL };
    } catch (err) {
      return { ok: false, error: err.message, model: OLLAMA_MODEL };
    }
  });
}

// Format/merge a transcript into existing markdown via Gemma. Image placement is
// a separate pipeline (see place-images.js) — this pass is text-only and never
// touches attached images.
async function handleFormat(event, { transcript, existing, context }) {
  const hasTranscript = transcript && transcript.trim();
  const hasContext = typeof context === "string" && context.trim().length > 0;
  if (!hasTranscript) return existing || "";

  // Cancellation token for this run + a helper to push progress updates to the
  // renderer so the user sees Gemma is making headway during a slow format.
  const token = beginRun();
  const report = (stage, detail = "") => {
    try {
      event.sender.send("llm:format-progress", { stage, detail });
    } catch {
      // Window may have gone away mid-format; progress is best-effort.
    }
  };
  const ensureLive = () => {
    if (token.cancelled) throw new FormatCancelled();
  };

  try {
    report("Preparing…");

    const systemPrompt = buildSystemPrompt({ hasContext });

    // Deterministic pre-search: if the context explicitly asks Gemma to look
    // something up, run the searches now so the results are in the prompt
    // regardless of whether the local model template supports tool calling.
    if (hasContext) report("Reading your context…");
    const preSearchResults = hasContext
      ? await preSearchFromContext(context)
      : [];
    ensureLive();

    // One formatting pass: assemble the user message (context, optional web
    // results, the running notes + the current transcript slice) and run the
    // generation. Returns cleaned Markdown.
    const runPass = async ({
      existingNotes,
      transcriptChunk,
      includePreSearch,
      includeWebTools,
      progressStage,
    }) => {
      const parts = [];
      if (hasContext) {
        parts.push(
          `Background context (for your interpretation only, do NOT echo into the notes):\n\n${context.trim()}`,
        );
        parts.push("---");
      }
      if (includePreSearch && preSearchResults.length) {
        parts.push(formatPreSearchBlock(preSearchResults));
        parts.push("---");
      }
      if (existingNotes && existingNotes.trim()) {
        parts.push(`Existing notes:\n\n${existingNotes}`);
        parts.push("---");
        parts.push(`New transcript to merge:\n\n${transcriptChunk}`);
      } else {
        parts.push(`Transcript:\n\n${transcriptChunk}`);
      }
      parts.push(
        'Return the complete updated Markdown notes. Output ONLY the notes — no greeting, no commentary, no "here\'s your notes" preamble.',
      );

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: parts.join("\n\n") },
      ];

      // Throttled live snippet of the latest generated text so the user can see
      // Gemma is actively writing, not stuck.
      let lastSentLength = 0;
      const onProgress = (full) => {
        if (full.length - lastSentLength < 24) return;
        lastSentLength = full.length;
        const tail = full.replace(/\s+/g, " ").trim().slice(-90);
        report(progressStage, tail);
      };

      // Intermediate slices (and any run with no context) never need the web
      // tool, so a single streamed turn suffices — keeps the per-pass work lean.
      if (!includeWebTools) {
        ensureLive();
        const message = await streamChat({
          messages,
          options: { temperature: 0.2 },
          token,
          onProgress,
        });
        return stripConversational(message.content);
      }

      // With tools enabled (final slice + context asked for a lookup), allow a
      // few turns so Gemma can call web_search and then synthesize.
      let passOut = "";
      const MAX_TURNS = 4;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        ensureLive();
        const message = await streamChat({
          messages,
          tools: [WEB_SEARCH_TOOL],
          options: { temperature: 0.2 },
          token,
          onProgress,
        });

        const toolCalls = message.tool_calls || [];
        if (toolCalls.length === 0) {
          passOut = message.content;
          break;
        }

        // Keep the assistant turn (with tool_calls) in history, then run each
        // tool and append a tool-role message with the result.
        messages.push(message);
        report("Searching the web…");
        for (const call of toolCalls) {
          const name = call.function?.name;
          const result = await executeToolCall(name, call.function?.arguments);
          messages.push({ role: "tool", name, content: result });
        }

        // On the last allowed turn, force one more chat call so the model can
        // synthesize the final notes from the tool results.
        if (turn === MAX_TURNS - 1) {
          ensureLive();
          report(progressStage);
          const finalMessage = await streamChat({
            messages,
            options: { temperature: 0.2 },
            token,
            onProgress,
          });
          passOut = finalMessage.content;
        }
      }
      return stripConversational(passOut);
    };

    // Feed Gemma the transcript a slice at a time, merging each slice into the
    // running notes. The whole transcript still gets formatted — it is just
    // assembled incrementally so each prompt (and Gemma's KV-cache memory) stays
    // bounded no matter how long the recording is, instead of one giant prompt
    // that can swap a low-RAM machine. Web results are applied once, on the final
    // slice, over the complete notes.
    const transcriptChunks = chunkText(transcript, FORMAT_CHUNK_CHARS);

    let runningNotes = existing && existing.trim() ? existing.trim() : "";
    let out = runningNotes;
    for (
      let chunkIndex = 0;
      chunkIndex < transcriptChunks.length;
      chunkIndex++
    ) {
      ensureLive();
      const isFinalChunk = chunkIndex === transcriptChunks.length - 1;
      const multiPass = transcriptChunks.length > 1;
      report(
        multiPass
          ? `Formatting part ${chunkIndex + 1} of ${transcriptChunks.length}…`
          : "Reading your notes…",
      );
      out = await runPass({
        existingNotes: runningNotes,
        transcriptChunk: transcriptChunks[chunkIndex],
        includePreSearch: isFinalChunk && preSearchResults.length > 0,
        includeWebTools: isFinalChunk && hasContext,
        progressStage: multiPass
          ? `Writing part ${chunkIndex + 1} of ${transcriptChunks.length}…`
          : "Writing your notes…",
      });
      runningNotes = out;
    }

    return out;
  } finally {
    endRun(token);
  }
}
