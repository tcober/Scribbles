// IPC handlers for the Gemma text pipeline: format/merge a transcript into the
// notes (slice by slice, with optional web search), cancel a run, and check that
// Ollama + the model are available. Image placement lives in place-images.js.
import { ipcMain } from "electron";

import { FORMAT_CHUNK_CHARS, OLLAMA_MODEL } from "../config.js";
import { ollama, streamChat } from "../ollama.js";
import { buildSystemPrompt } from "../prompts.js";
import {
  chunkText,
  splitRecentNotes,
  stripConversational,
} from "../text-utils.js";
import {
  WEB_SEARCH_TOOL,
  executeToolCall,
  formatPreSearchBlock,
  preSearchFromContext,
} from "../web-search.js";
import { beginReportedRun, cancelActiveRun, endRun } from "./active-run.js";

// With web tools enabled, how many model turns we allow for searching before
// forcing a final synthesis call.
const MAX_TOOL_TURNS = 4;

export function registerFormatHandlers() {
  // Cancel the in-flight format or image-placement run: flag the active token
  // (checked between stages and inside the stream loop) and abort the live
  // Ollama stream so a long generation stops immediately. Shared with placement.
  ipcMain.handle("llm:cancel-format", cancelActiveRun);

  ipcMain.handle("llm:format", handleFormat);

  ipcMain.handle("llm:check", async () => {
    try {
      const models = await ollama.list();
      const hasModel = models.models?.some((model) =>
        model.name.startsWith(OLLAMA_MODEL),
      );
      return { ok: true, hasModel: !!hasModel, model: OLLAMA_MODEL };
    } catch (error) {
      return { ok: false, error: error.message, model: OLLAMA_MODEL };
    }
  });
}

// Format/merge a transcript into existing markdown via Gemma (text-only). The
// transcript is formatted a slice at a time, merging each slice into the
// running notes, so each prompt (and the KV-cache) stays bounded no matter how
// long the recording is. Web results are applied once, on the final slice.
async function handleFormat(event, { transcript, existing, context }) {
  const hasTranscript = transcript && transcript.trim();
  const hasContext = typeof context === "string" && context.trim().length > 0;
  if (!hasTranscript) return existing || "";

  // Cancellation token for this run plus the report/ensureLive helpers that push
  // progress to the renderer and bail out if the user cancels mid-format.
  const run = beginReportedRun(event);

  try {
    run.report("Preparing…");

    const systemPrompt = buildSystemPrompt({ hasContext });

    // If the context asks Gemma to look something up, run the searches now so
    // the results are in the prompt even if the model template can't call tools.
    if (hasContext) run.report("Reading your context…");
    const preSearchResults = hasContext
      ? await preSearchFromContext(context)
      : [];
    run.ensureLive();

    const transcriptChunks = chunkText(transcript, FORMAT_CHUNK_CHARS);
    const multiPass = transcriptChunks.length > 1;

    // As passes merge slices in, the running notes grow. Set the settled head
    // aside verbatim before each pass so Gemma only re-reads and rewrites the
    // recent tail — without this, every pass regenerates the whole document
    // and a long recording costs quadratic work.
    let settledHead = "";
    let runningNotes = existing && existing.trim() ? existing.trim() : "";
    for (
      let chunkIndex = 0;
      chunkIndex < transcriptChunks.length;
      chunkIndex++
    ) {
      run.ensureLive();
      const isFinalChunk = chunkIndex === transcriptChunks.length - 1;
      run.report(
        multiPass
          ? `Formatting part ${chunkIndex + 1} of ${transcriptChunks.length}…`
          : "Reading your notes…",
      );
      const { head, tail } = splitRecentNotes(runningNotes);
      if (head) settledHead = settledHead ? `${settledHead}\n\n${head}` : head;
      runningNotes = await runFormatPass({
        run,
        systemPrompt,
        context: hasContext ? context.trim() : "",
        existingNotes: tail,
        transcriptChunk: transcriptChunks[chunkIndex],
        preSearch: isFinalChunk ? preSearchResults : [],
        useWebTools: isFinalChunk && hasContext,
        progressStage: multiPass
          ? `Writing part ${chunkIndex + 1} of ${transcriptChunks.length}…`
          : "Writing your notes…",
      });
    }

    return settledHead ? `${settledHead}\n\n${runningNotes}` : runningNotes;
  } finally {
    endRun(run.token);
  }
}

// One formatting pass: assemble the user message (context, optional web
// results, the running notes + the current transcript slice) and run the
// generation. Returns cleaned Markdown.
async function runFormatPass({
  run,
  systemPrompt,
  context,
  existingNotes,
  transcriptChunk,
  preSearch,
  useWebTools,
  progressStage,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: buildPassRequest({
        context,
        preSearch,
        existingNotes,
        transcriptChunk,
      }),
    },
  ];
  const onProgress = makeProgressReporter(run.report, progressStage);

  // Intermediate slices (and any run with no context) never need the web tool,
  // so a single streamed turn suffices — keeps the per-pass work lean.
  if (!useWebTools) {
    run.ensureLive();
    const message = await streamChat({
      messages,
      options: { temperature: 0.2 },
      token: run.token,
      onProgress,
    });
    return stripConversational(message.content);
  }

  // With tools enabled (final slice + context asked for a lookup), allow a few
  // turns so Gemma can call web_search and then synthesize.
  let content = "";
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    run.ensureLive();
    const message = await streamChat({
      messages,
      tools: [WEB_SEARCH_TOOL],
      options: { temperature: 0.2 },
      token: run.token,
      onProgress,
    });

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      content = message.content;
      break;
    }

    // Keep the assistant turn (with tool_calls) in history, then run each tool
    // and append a tool-role message with the result.
    messages.push(message);
    run.report("Searching the web…");
    for (const call of toolCalls) {
      const name = call.function?.name;
      const result = await executeToolCall(name, call.function?.arguments);
      messages.push({ role: "tool", name, content: result });
    }

    // On the last allowed turn, force one more chat call so the model can
    // synthesize the final notes from the tool results.
    if (turn === MAX_TOOL_TURNS - 1) {
      run.ensureLive();
      run.report(progressStage);
      const finalMessage = await streamChat({
        messages,
        options: { temperature: 0.2 },
        token: run.token,
        onProgress,
      });
      content = finalMessage.content;
    }
  }
  return stripConversational(content);
}

// The user-message body for one pass: optional background context and web
// results, then the notes-so-far and the transcript slice to merge in.
function buildPassRequest({
  context,
  preSearch,
  existingNotes,
  transcriptChunk,
}) {
  const parts = [];
  if (context) {
    parts.push(
      `Background context (for your interpretation only, do NOT echo into the notes):\n\n${context}`,
    );
    parts.push("---");
  }
  if (preSearch.length) {
    parts.push(formatPreSearchBlock(preSearch));
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
  return parts.join("\n\n");
}

// Throttled live snippet of the latest generated text so the user can see
// Gemma is actively writing, not stuck.
function makeProgressReporter(report, progressStage) {
  let lastSentLength = 0;
  return (fullText) => {
    if (fullText.length - lastSentLength < 24) return;
    lastSentLength = fullText.length;
    const tail = fullText.replace(/\s+/g, " ").trim().slice(-90);
    report(progressStage, tail);
  };
}
