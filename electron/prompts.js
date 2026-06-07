// The actual prompt text lives in ./prompts/*.md so it's easy to read and edit
// without wading through JS string escaping. This module just loads those files
// and assembles the system prompt from the pieces that apply to a given request.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const readPrompt = (file) =>
  readFileSync(join(promptsDir, file), "utf8").trim();

// Loaded once at startup. The base note-taking rules are always present; the
// context fragment is appended only when context is provided.
const NOTES_RULES = readPrompt("notes.md");
const CONTEXT_RULES = readPrompt("context.md");

// System prompt for the per-image vision pass: a short caption describing what a
// single attachment shows, used both to place the image and as its caption.
export const IMAGE_DESCRIBE_SYSTEM_PROMPT = readPrompt("image-describe.md");

// System prompt for the image-placement pass: picks which note block each image
// should follow and returns placement JSON only (it never rewrites the notes).
export const PLACE_IMAGES_SYSTEM_PROMPT = readPrompt("place-images.md");

export function buildSystemPrompt({ hasContext }) {
  const sections = [NOTES_RULES];

  if (hasContext) {
    sections.push(CONTEXT_RULES);
  }

  return sections.join("\n\n");
}
