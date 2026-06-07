import { ipcMain } from "electron";
import { promises as fs } from "node:fs";

import { FORMAT_CHUNK_CHARS, OLLAMA_MODEL } from "../config.js";
import { FormatCancelled, ollama, streamChat } from "../ollama.js";
import { buildSystemPrompt, IMAGE_DESCRIBE_SYSTEM_PROMPT } from "../prompts.js";
import { chunkText, stripConversational } from "../text-utils.js";
import {
  WEB_SEARCH_TOOL,
  executeToolCall,
  formatPreSearchBlock,
  preSearchFromContext,
} from "../web-search.js";

// Tracks the format currently running so a "cancel" IPC message can flip the
// flag (and abort the live Ollama stream). Only one format runs at a time — the
// renderer's status guard enforces that — so a single module-level token is enough.
let activeFormatToken = null;

export function registerFormatHandlers() {
  // Cancel the in-flight format: flag the active token (checked between stages and
  // inside the stream loop) and abort the live Ollama stream so a long generation
  // stops immediately rather than running to completion.
  ipcMain.handle("llm:cancel-format", () => {
    if (activeFormatToken) activeFormatToken.cancelled = true;
    ollama.abort();
  });

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

// Format/merge a transcript into existing markdown via Gemma. Optionally accepts
// image attachments; Gemma sees them (vision) and is told to insert them where
// they best fit using [[image:N]] placeholders, which we then resolve to real
// note-image:// URLs.
async function handleFormat(event, { transcript, existing, context, images }) {
  const hasTranscript = transcript && transcript.trim();
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasContext = typeof context === "string" && context.trim().length > 0;
  if (!hasTranscript && !hasImages) return existing || "";

  // Cancellation token for this run + a helper to push progress updates to the
  // renderer so the user sees Gemma is making headway during a slow format.
  const token = { cancelled: false };
  activeFormatToken = token;
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

    const systemPrompt = buildSystemPrompt({
      hasContext,
      hasImages,
      imageCount: hasImages ? images.length : 0,
    });

    // Deterministic pre-search: if the context explicitly asks Gemma to look
    // something up, run the searches now so the results are in the prompt
    // regardless of whether the local model template supports tool calling.
    if (hasContext) report("Reading your context…");
    const preSearchResults = hasContext
      ? await preSearchFromContext(context)
      : [];
    ensureLive();

    // Analyze each attached image on its own. Doing one vision pass per image
    // (instead of cramming them all into a single message) gives us a reliable,
    // numbered description for each — Gemma's multi-image binding is too weak to
    // tell image #1 from #3 when they're batched, which is what made placement of
    // several images degrade into a blurry dump. We place by description instead.
    if (hasImages) report("Looking at images…", `${images.length} attached`);
    const imageBase64 = hasImages
      ? await Promise.all(
          images.map(async (img) =>
            (await fs.readFile(img.path)).toString("base64"),
          ),
        )
      : [];
    const imageDescriptions = hasImages
      ? await Promise.all(imageBase64.map((b64) => describeImage(b64, token)))
      : [];
    ensureLive();

    // One formatting pass: assemble the user message (context, optional web
    // results, optional image descriptions, the running notes + the current
    // transcript slice) and run the generation. Returns cleaned Markdown.
    const runPass = async ({
      existingNotes,
      transcriptChunk,
      includeImages,
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
      if (includeImages && hasImages) {
        const lines = [
          "Attached images (place each one where it fits best using ![caption](image:N)):",
        ];
        imageDescriptions.forEach((desc, index) => {
          lines.push(
            `[${index + 1}] ${desc || "image (no description available)"}`,
          );
        });
        parts.push(lines.join("\n"));
        parts.push("---");
      }
      const chunkHasText = transcriptChunk && transcriptChunk.trim();
      if (existingNotes && existingNotes.trim()) {
        parts.push(`Existing notes:\n\n${existingNotes}`);
        parts.push("---");
        parts.push(
          chunkHasText
            ? `New transcript to merge:\n\n${transcriptChunk}`
            : "(No new transcript — just place the attached images appropriately in the existing notes.)",
        );
      } else {
        parts.push(
          chunkHasText
            ? `Transcript:\n\n${transcriptChunk}`
            : "(No transcript — produce a brief note framed around the attached images.)",
        );
      }
      parts.push(
        includeImages && hasImages
          ? `Return the complete updated Markdown notes with the ${images.length} attached image(s) inserted using the [image:N] placeholder syntax. Output ONLY the notes — no greeting, no commentary, no "here's your notes" preamble.`
          : 'Return the complete updated Markdown notes. Output ONLY the notes — no greeting, no commentary, no "here\'s your notes" preamble.',
      );

      // The formatting pass is text-only: each image is already analyzed above
      // and represented by its numbered description, so Gemma places by content
      // rather than re-deriving it from a hard-to-disambiguate batch of images.
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
    // that can swap a low-RAM machine. Images and web results are applied once,
    // on the final slice, over the complete notes.
    const transcriptChunks = hasTranscript
      ? chunkText(transcript, FORMAT_CHUNK_CHARS)
      : [""];

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
        includeImages: isFinalChunk && hasImages,
        includePreSearch: isFinalChunk && preSearchResults.length > 0,
        includeWebTools: isFinalChunk && hasContext,
        progressStage: multiPass
          ? `Writing part ${chunkIndex + 1} of ${transcriptChunks.length}…`
          : "Writing your notes…",
      });
      runningNotes = out;
    }

    if (hasImages) {
      // Resolve [image:N] / image:N placeholders to real note-image:// URLs.
      out = out.replace(/\(image:(\d+)\)/g, (full, numberText) => {
        const index = parseInt(numberText, 10) - 1;
        const img = images[index];
        return img ? `(${img.url})` : full;
      });
      // Fallback: append any images Gemma forgot to place, captioned with the
      // description we generated for them.
      for (let index = 0; index < images.length; index++) {
        if (!out.includes(images[index].url)) {
          const caption =
            imageDescriptions[index] || `attached image ${index + 1}`;
          out += `\n\n![${caption}](${images[index].url})`;
        }
      }
    }

    return out;
  } finally {
    if (activeFormatToken === token) activeFormatToken = null;
  }
}

// Run a single-image vision pass so each attachment gets its own concise
// description. Done per image (rather than batching) because the local vision
// model can't reliably tell several batched images apart — analyzing them one at
// a time is what lets the formatter place each one in the right spot. Best-effort:
// on any failure we return '' and the formatter falls back to generic captions.
async function describeImage(base64, token) {
  try {
    const message = await streamChat({
      messages: [
        { role: "system", content: IMAGE_DESCRIBE_SYSTEM_PROMPT },
        { role: "user", content: "Describe this image.", images: [base64] },
      ],
      options: { temperature: 0.1 },
      token,
    });
    return message.content.replace(/\s+/g, " ");
  } catch (err) {
    // Let a deliberate cancel bubble up; swallow only real description failures.
    if (err instanceof FormatCancelled) throw err;
    return "";
  }
}
