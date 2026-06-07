import { ollama } from "../ollama.js";

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
