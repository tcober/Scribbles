// The actual prompt text lives in ./prompts/*.md so it's easy to read and edit
// without wading through JS string escaping. This module just loads those files
// and assembles the system prompt from the pieces that apply to a given request.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), "prompts");
const readPrompt = (file) => readFileSync(join(promptsDir, file), "utf8").trim();

// Loaded once at startup. The base note-taking rules are always present; the
// context and image fragments are appended only when those inputs exist.
const NOTES_RULES = readPrompt("notes.md");
const CONTEXT_RULES = readPrompt("context.md");
const IMAGE_RULES = readPrompt("images.md");

// System prompt for the per-image vision pass: one concise sentence describing
// what a single attachment shows, used later to place it in the notes.
export const IMAGE_DESCRIBE_SYSTEM_PROMPT = readPrompt("image-describe.md");

export function buildSystemPrompt({ hasContext, hasImages, imageCount }) {
  const sections = [NOTES_RULES];

  if (hasContext) {
    sections.push(CONTEXT_RULES);
  }

  if (hasImages) {
    sections.push(IMAGE_RULES.replaceAll("{{imageCount}}", String(imageCount)));
  }

  return sections.join("\n\n");
}
