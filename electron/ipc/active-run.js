import { FormatCancelled, ollama } from "../ollama.js";

// Tracks the single LLM run currently in flight (a format OR an image-placement
// pass — the renderer's status guard ensures only one runs at a time). A cancel
// IPC message flips this token (checked between stages and inside the stream
// loop) and aborts the live Ollama stream so a long generation stops at once.
let activeToken = null;

export function beginRun() {
  const token = { cancelled: false };
  activeToken = token;
  return token;
}

export function endRun(token) {
  if (activeToken === token) activeToken = null;
}

export function cancelActiveRun() {
  if (activeToken) activeToken.cancelled = true;
  ollama.abort();
}

// Start a run and bundle it with the two helpers every LLM pass needs:
//   - report(stage, detail): best-effort progress update to the renderer. The
//     window may have gone away mid-run, so a failed send is swallowed.
//   - ensureLive(): throw FormatCancelled if this run has been cancelled,
//     checked between stages and inside the stream loop.
// The caller still owns endRun(token) in its finally block.
export function beginReportedRun(event) {
  const token = beginRun();

  const report = (stage, detail = "") => {
    try {
      event.sender.send("llm:format-progress", { stage, detail });
    } catch {
      // Window may have gone away mid-run; progress is best-effort.
    }
  };

  const ensureLive = () => {
    if (token.cancelled) throw new FormatCancelled();
  };

  return { token, report, ensureLive };
}
