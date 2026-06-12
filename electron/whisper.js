// Locates the whisper-cli binary and ensures the model file is present,
// downloading it from Hugging Face into userData/models on first use.
import { app } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promises as fs, createWriteStream, existsSync } from "node:fs";
import https from "node:https";

import { WHISPER_MODEL } from "./config.js";
import { modelPath } from "./paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the whisper-cli binary. Priority:
//   1. SCRIBBLES_WHISPER_BIN override (advanced users / custom builds)
//   2. the self-contained binary bundled in the packaged app (Contents/Resources/whisper)
//   3. the vendored binary in the repo during dev (scripts/vendor-whisper.sh)
//   4. a `whisper-cli` found on PATH (e.g. `brew install whisper-cpp`)
export function whisperBin() {
  if (process.env.SCRIBBLES_WHISPER_BIN)
    return process.env.SCRIBBLES_WHISPER_BIN;
  const bundled = app.isPackaged
    ? join(process.resourcesPath, "whisper", "whisper-cli")
    : join(__dirname, "..", "resources", "whisper", "whisper-cli");
  if (existsSync(bundled)) return bundled;
  return "whisper-cli";
}

// Ensure the Whisper model file exists in userData/models. Downloads it from
// Hugging Face (the same URL whisper.cpp's official download-ggml-model.sh uses).
export async function ensureWhisperModel() {
  const target = modelPath();
  if (existsSync(target)) return target;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin`;
  await downloadFile(url, target);
  return target;
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(destination);
    // Abandon a failed or redirected attempt: close the stream and remove the
    // partial file so a retry never sees a truncated model.
    const discardPartial = () => {
      fileStream.close();
      fs.unlink(destination).catch(() => {});
    };

    const request = https.get(url, (response) => {
      const { statusCode } = response;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        discardPartial();
        return downloadFile(response.headers.location, destination).then(
          resolve,
          reject,
        );
      }
      if (statusCode !== 200) {
        discardPartial();
        return reject(new Error(`Download failed (${statusCode}) for ${url}`));
      }
      response.pipe(fileStream);
      fileStream.on("finish", () => fileStream.close(resolve));
    });
    request.on("error", (error) => {
      discardPartial();
      reject(error);
    });
  });
}
