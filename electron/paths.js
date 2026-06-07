// Resolves every on-disk location under userData (notes, images, models) and
// guards interpolated ids against path traversal.
import { app } from "electron";
import { join } from "node:path";
import { promises as fs } from "node:fs";

import { WHISPER_MODEL } from "./config.js";

export function notesDir() {
  return join(app.getPath("userData"), "notes");
}

// Guard an id (note id, filename) before interpolating it into a file path, so a
// crafted value can't escape its directory. Ids are UUIDs in normal use.
export function assertSafeId(id) {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.includes("..") ||
    id.includes("/") ||
    id.includes("\\")
  ) {
    throw new Error(`Invalid id: ${id}`);
  }
  return id;
}

export function modelsDir() {
  return join(app.getPath("userData"), "models");
}

export function imagesRoot() {
  return join(app.getPath("userData"), "images");
}

export function imagesDirFor(noteId) {
  return join(imagesRoot(), noteId);
}

export function modelPath() {
  return join(modelsDir(), `ggml-${WHISPER_MODEL}.bin`);
}

export async function ensureDirs() {
  await fs.mkdir(notesDir(), { recursive: true });
  await fs.mkdir(modelsDir(), { recursive: true });
  await fs.mkdir(imagesRoot(), { recursive: true });
}
