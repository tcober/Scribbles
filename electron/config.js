import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const OLLAMA_MODEL = process.env.SCRIBBLES_MODEL || "gemma4";
export const WHISPER_MODEL =
  process.env.SCRIBBLES_WHISPER_MODEL || "large-v3-turbo";

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

// How long Ollama keeps the model resident after a request. Default matches
// Ollama's own 5-minute default, so behaviour is unchanged unless overridden.
// On a low-RAM machine keep it short ("30s", "0") so the model releases sooner;
// raise it ("30m", or "-1" for never) only if you have headroom and want
// consecutive formats to stay instant.
export const OLLAMA_KEEP_ALIVE =
  process.env.SCRIBBLES_OLLAMA_KEEP_ALIVE || "5m";

// Short domain hint passed to whisper as the initial prompt. whisper's prompt
// budget is small (~n_text_ctx/2 tokens), and we now spend most of it on the
// running transcript (carry-over context — see audio:transcribe), which is what
// actually keeps proper nouns and word boundaries consistent across chunks. A
// brief topic hint is enough to bias toward dev terminology; large-v3-turbo no
// longer needs the long vocabulary list the smaller models did.
export const WHISPER_PROMPT =
  process.env.SCRIBBLES_WHISPER_PROMPT ||
  "Technical software development notes covering programming, web development, " +
    "cloud infrastructure, and developer tooling.";

// Cap on how much prior transcript we feed back into the next chunk as context.
// whisper truncates the prompt to its last tokens, so the most recent words win.
export const CARRYOVER_CHARS = 480;

// Roughly how many characters of transcript to hand Gemma per formatting pass.
// A long transcript is split into slices of about this size and merged into the
// running notes one slice at a time, so each prompt (and Gemma's KV-cache memory)
// stays bounded no matter how long the recording is. Smaller = lower peak memory
// but more passes (slower, more seams); larger = fewer passes but heavier prompts.
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
