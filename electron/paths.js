import { app } from "electron";
import { join } from "node:path";
import { promises as fs } from "node:fs";

import { WHISPER_MODEL } from "./config.js";

export function notesDir() {
  return join(app.getPath("userData"), "notes");
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
