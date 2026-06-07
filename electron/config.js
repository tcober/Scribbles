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

// Roughly how many transcript characters Gemma formats per pass. Slicing keeps
// each prompt (and the KV-cache) bounded; smaller = lower peak memory but more
// passes, larger = fewer passes but heavier prompts.
export const FORMAT_CHUNK_CHARS =
  Number(process.env.SCRIBBLES_FORMAT_CHUNK_CHARS) || 2500;

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
