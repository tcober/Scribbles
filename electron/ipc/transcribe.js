import { ipcMain } from "electron";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import crypto from "node:crypto";

import { CARRYOVER_CHARS, WHISPER_PROMPT } from "../config.js";
import { ensureWhisperModel, whisperBin } from "../whisper.js";

const execFileP = promisify(execFile);

export function registerTranscribeHandler() {
  // Transcribe a WAV buffer by shelling out to Homebrew's whisper-cli (whisper.cpp).
  // `carryover` is the tail of the transcript so far; feeding it back as context
  // keeps word boundaries and proper nouns consistent across the independent
  // per-chunk whisper calls (otherwise every chunk is decoded cold).
  ipcMain.handle("audio:transcribe", async (_event, wavBuffer, opts = {}) => {
    const modelFile = await ensureWhisperModel();
    const binPath = whisperBin();

    const base = join(
      os.tmpdir(),
      `scribbles-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    );
    const wavPath = `${base}.wav`;
    const txtPath = `${base}.txt`;
    await fs.writeFile(wavPath, Buffer.from(wavBuffer));

    // Build the initial prompt: a short domain hint plus the most recent
    // transcript. whisper keeps the prompt's trailing tokens, so order matters —
    // hint first, recent speech last.
    const carryover =
      typeof opts.carryover === "string"
        ? opts.carryover.replace(/\s+/g, " ").trim().slice(-CARRYOVER_CHARS)
        : "";
    const prompt = carryover ? `${WHISPER_PROMPT} ${carryover}` : WHISPER_PROMPT;

    try {
      await execFileP(
        binPath,
        [
          "-m",
          modelFile,
          "-f",
          wavPath,
          "-otxt",
          "-of",
          base,
          "-nt",
          "-np",
          "-l",
          "en",
          "--prompt",
          prompt,
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      );

      const text = await fs.readFile(txtPath, "utf8").catch(() => "");
      return text.trim();
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new Error(
          `Could not find the whisper-cli binary at "${binPath}". In development, ` +
            `run "npm run vendor:whisper"; otherwise install it with "brew install whisper-cpp".`,
        );
      }
      throw new Error(
        `whisper-cli failed: ${err.stderr?.toString() || err.message}`,
      );
    } finally {
      await fs.unlink(wavPath).catch(() => {});
      await fs.unlink(txtPath).catch(() => {});
    }
  });
}
