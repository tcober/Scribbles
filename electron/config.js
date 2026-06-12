// Central config: model names, AI tunables, and MIME/extension maps. Most values
// are env-overridable (SCRIBBLES_*) so low-RAM machines can dial things down.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const OLLAMA_MODEL = process.env.SCRIBBLES_MODEL || "gemma4";
export const WHISPER_MODEL =
  process.env.SCRIBBLES_WHISPER_MODEL || "large-v3-turbo";

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

// How long Ollama keeps the model resident after a request (Ollama's own default
// is 5m). Lower it ("30s", "0") to free memory sooner on low-RAM machines.
export const OLLAMA_KEEP_ALIVE =
  process.env.SCRIBBLES_OLLAMA_KEEP_ALIVE || "5m";

// Context window requested on every Ollama call. Two reasons to pin it:
//   1. The KV cache is allocated for the full window at model load — a
//      Modelfile declaring a huge context can swap the whole machine on its
//      own, which shows up as the desktop freezing when a format starts.
//   2. Load-time options must match between calls, or Ollama reloads the
//      model to resize — paying the freeze again mid-pipeline.
// 8192 comfortably fits our biggest prompt (system rules + context + bounded
// notes tail + one transcript slice) plus the regenerated notes.
export const OLLAMA_NUM_CTX = Number(process.env.SCRIBBLES_NUM_CTX) || 8192;

// Short domain hint passed to whisper as the initial prompt to bias toward dev
// terminology. Cross-chunk consistency comes from the carry-over transcript (see
// audio:transcribe), so this only needs to be a brief topic nudge.
export const WHISPER_PROMPT =
  process.env.SCRIBBLES_WHISPER_PROMPT ||
  "Technical software development notes covering programming, web development, " +
    "cloud infrastructure, and developer tooling.";

// Cap on how much prior transcript we feed back into the next chunk as context.
// whisper truncates the prompt to its last tokens, so the most recent words win.
export const CARRYOVER_CHARS = 480;

// Roughly how many transcript characters Gemma formats per pass. 6000 chars is
// about eight minutes of speech, so most recordings format in a single pass.
// Every extra pass costs a full prompt AND a full regeneration of the notes so
// far, so prefer fewer, larger slices — peak memory is already capped by
// OLLAMA_NUM_CTX and the per-pass tail bound (splitRecentNotes).
export const FORMAT_CHUNK_CHARS =
  Number(process.env.SCRIBBLES_FORMAT_CHUNK_CHARS) || 6000;

// App/window icon (also drives the macOS dock icon in development).
export const APP_ICON = join(__dirname, "..", "build", "icon.png");

export const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const EXT_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);
