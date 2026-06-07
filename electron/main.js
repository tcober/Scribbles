import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  systemPreferences,
  protocol,
  net,
  nativeImage,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import crypto from "node:crypto";
import https from "node:https";
import { createWriteStream, existsSync } from "node:fs";

import { Ollama } from "ollama";

const execFileP = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OLLAMA_MODEL = process.env.SCRIBBLES_MODEL || "gemma4";
const WHISPER_MODEL = process.env.SCRIBBLES_WHISPER_MODEL || "large-v3-turbo";

// Resolve the whisper-cli binary. Priority:
//   1. SCRIBBLES_WHISPER_BIN override (advanced users / custom builds)
//   2. the self-contained binary bundled in the packaged app (Contents/Resources/whisper)
//   3. the vendored binary in the repo during dev (scripts/vendor-whisper.sh)
//   4. a `whisper-cli` found on PATH (e.g. `brew install whisper-cpp`)
function whisperBin() {
  if (process.env.SCRIBBLES_WHISPER_BIN)
    return process.env.SCRIBBLES_WHISPER_BIN;
  const bundled = app.isPackaged
    ? join(process.resourcesPath, "whisper", "whisper-cli")
    : join(__dirname, "..", "resources", "whisper", "whisper-cli");
  if (existsSync(bundled)) return bundled;
  return "whisper-cli";
}

// Short domain hint passed to whisper as the initial prompt. whisper's prompt
// budget is small (~n_text_ctx/2 tokens), and we now spend most of it on the
// running transcript (carry-over context — see audio:transcribe), which is what
// actually keeps proper nouns and word boundaries consistent across chunks. A
// brief topic hint is enough to bias toward dev terminology; large-v3-turbo no
// longer needs the long vocabulary list the smaller models did.
const WHISPER_PROMPT =
  process.env.SCRIBBLES_WHISPER_PROMPT ||
  "Technical software development notes covering programming, web development, " +
    "cloud infrastructure, and developer tooling.";

// Cap on how much prior transcript we feed back into the next chunk as context.
// whisper truncates the prompt to its last tokens, so the most recent words win.
const CARRYOVER_CHARS = 480;

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
});

// Thrown when the user cancels an in-progress format. Carries a recognizable
// message so the renderer can distinguish a deliberate cancel from a real error.
class FormatCancelled extends Error {
  constructor() {
    super("FORMAT_CANCELLED");
    this.name = "FormatCancelled";
  }
}

// Tracks the format currently running so a "cancel" IPC message can flip the
// flag (and abort the live Ollama stream). Only one format runs at a time — the
// renderer's status guard enforces that — so a single module-level token is enough.
let activeFormatToken = null;

// Run one streaming chat turn against Ollama, accumulating the text (and any
// tool calls) as it arrives. Streaming is what makes the request abortable
// mid-generation: `ollama.abort()` only cancels ongoing *streamed* requests, and
// it lets us report live progress to the renderer via onProgress.
async function streamChat({ messages, tools, options, token, onProgress }) {
  const iterator = await ollama.chat({
    model: OLLAMA_MODEL,
    messages,
    ...(tools ? { tools } : {}),
    options,
    stream: true,
  });

  let content = "";
  const toolCalls = [];
  try {
    for await (const chunk of iterator) {
      if (token?.cancelled) {
        iterator.abort();
        throw new FormatCancelled();
      }
      const part = chunk.message || {};
      if (part.content) {
        content += part.content;
        onProgress?.(content);
      }
      if (Array.isArray(part.tool_calls) && part.tool_calls.length) {
        toolCalls.push(...part.tool_calls);
      }
    }
  } catch (err) {
    // An external abort (cancel IPC calling ollama.abort()) surfaces here as an
    // AbortError; treat it — and our own sentinel — as a cancellation.
    if (err instanceof FormatCancelled) throw err;
    if (token?.cancelled || err?.name === "AbortError")
      throw new FormatCancelled();
    throw err;
  }

  return { role: "assistant", content: content.trim(), tool_calls: toolCalls };
}

// Cancel the in-flight format: flag the active token (checked between stages and
// inside the stream loop) and abort the live Ollama stream so a long generation
// stops immediately rather than running to completion.
ipcMain.handle("llm:cancel-format", () => {
  if (activeFormatToken) activeFormatToken.cancelled = true;
  ollama.abort();
});

// App/window icon (also drives the macOS dock icon in development).
const APP_ICON = join(__dirname, "..", "build", "icon.png");

function notesDir() {
  return join(app.getPath("userData"), "notes");
}

function modelsDir() {
  return join(app.getPath("userData"), "models");
}

function imagesRoot() {
  return join(app.getPath("userData"), "images");
}

function imagesDirFor(noteId) {
  return join(imagesRoot(), noteId);
}

function modelPath() {
  return join(modelsDir(), `ggml-${WHISPER_MODEL}.bin`);
}

async function ensureDirs() {
  await fs.mkdir(notesDir(), { recursive: true });
  await fs.mkdir(modelsDir(), { recursive: true });
  await fs.mkdir(imagesRoot(), { recursive: true });
}

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const EXT_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

// Ensure the Whisper model file exists in userData/models. Downloads it from
// Hugging Face (the same URL whisper.cpp's official download-ggml-model.sh uses).
async function ensureWhisperModel() {
  const target = modelPath();
  if (existsSync(target)) return target;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin`;
  await downloadFile(url, target);
  return target;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        file.close();
        fs.unlink(dest).catch(() => {});
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest).catch(() => {});
        return reject(
          new Error(`Download failed (${res.statusCode}) for ${url}`),
        );
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("error", (err) => {
      file.close();
      fs.unlink(dest).catch(() => {});
      reject(err);
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#10131a",
    icon: APP_ICON,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.NODE_ENV === "development") {
    await win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  }
}

// Register the custom image protocol BEFORE app ready so the renderer can resolve
// note-image:// URLs in <img> tags within the markdown preview.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "note-image",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

app.whenReady().then(async () => {
  await ensureDirs();

  // Replace the default Electron dock icon on macOS (the .icns is used for
  // packaged builds; this covers `npm run dev`/`npm start`).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(APP_ICON);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  // Serve note-image://<noteId>/<filename> from userData/images/<noteId>/<filename>.
  protocol.handle("note-image", async (request) => {
    try {
      const url = new URL(request.url);
      const noteId = url.hostname;
      const file = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!noteId || !file || file.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }
      const filePath = join(imagesDirFor(noteId), file);
      return net.fetch(`file://${filePath}`);
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  });

  // Grant microphone access automatically — this is the only sensitive permission we use.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media" || permission === "microphone");
    },
  );

  if (process.platform === "darwin") {
    try {
      await systemPreferences.askForMediaAccess("microphone");
    } catch {}
  }

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------- IPC ----------------

ipcMain.handle("notes:list", async () => {
  await ensureDirs();
  const files = await fs.readdir(notesDir());
  const notes = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(join(notesDir(), file), "utf8");
      const note = JSON.parse(raw);
      notes.push({
        id: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
        createdAt: note.createdAt,
      });
    } catch {
      // ignore corrupted file
    }
  }
  notes.sort(
    (first, second) => (second.updatedAt || 0) - (first.updatedAt || 0),
  );
  return notes;
});

ipcMain.handle("notes:load", async (_event, id) => {
  const raw = await fs.readFile(join(notesDir(), `${id}.json`), "utf8");
  return JSON.parse(raw);
});

ipcMain.handle("notes:create", async (_event, title) => {
  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: title || "Untitled note",
    markdown: "",
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(
    join(notesDir(), `${note.id}.json`),
    JSON.stringify(note, null, 2),
  );
  return note;
});

ipcMain.handle("notes:save", async (_event, note) => {
  note.updatedAt = Date.now();
  await fs.writeFile(
    join(notesDir(), `${note.id}.json`),
    JSON.stringify(note, null, 2),
  );
  return note;
});

ipcMain.handle("notes:delete", async (_event, id) => {
  await fs.unlink(join(notesDir(), `${id}.json`)).catch(() => {});
  return true;
});

ipcMain.handle("notes:revealFolder", async () => {
  await ensureDirs();
  const dir = notesDir();
  // shell.openPath resolves to a string: empty on success, error msg on failure.
  const err = await shell.openPath(dir);
  if (err) throw new Error(`Could not open ${dir}: ${err}`);
  return dir;
});

// Save a binary image (dataUrl or raw buffer) to userData/images/<noteId>/.
ipcMain.handle("images:add", async (_event, { noteId, dataUrl }) => {
  if (!noteId || !dataUrl) throw new Error("noteId and dataUrl required");

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected a data: URL");
  const mime = match[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);

  const buf = Buffer.from(match[2], "base64");
  const id = crypto.randomUUID();
  const filename = `${id}${ext}`;

  const dir = imagesDirFor(noteId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, filename), buf);

  return {
    id,
    filename,
    url: `note-image://${noteId}/${filename}`,
    path: join(dir, filename),
    mime,
  };
});

ipcMain.handle("images:delete", async (_event, { noteId, filename }) => {
  if (!noteId || !filename || filename.includes("..")) return false;
  await fs.unlink(join(imagesDirFor(noteId), filename)).catch(() => {});
  return true;
});

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

// Format/merge a transcript into existing markdown via Gemma. Optionally accepts
// image attachments; Gemma sees them (vision) and is told to insert them where
// they best fit using [[image:N]] placeholders, which we then resolve to real
// note-image:// URLs.
ipcMain.handle(
  "llm:format",
  async (event, { transcript, existing, context, images }) => {
    const hasTranscript = transcript && transcript.trim();
    const hasImages = Array.isArray(images) && images.length > 0;
    const hasContext = typeof context === "string" && context.trim().length > 0;
    if (!hasTranscript && !hasImages) return existing || "";

    // Cancellation token for this run + a helper to push progress updates to the
    // renderer so the user sees Gemma is making headway during a slow format.
    const token = { cancelled: false };
    activeFormatToken = token;
    const report = (stage, detail = "") => {
      try {
        event.sender.send("llm:format-progress", { stage, detail });
      } catch {
        // Window may have gone away mid-format; progress is best-effort.
      }
    };
    const ensureLive = () => {
      if (token.cancelled) throw new FormatCancelled();
    };

    try {
      report("Preparing…");

      const systemRules = [
        "You are a note-taking assistant. You take raw speech transcripts and produce clean, well-organized Markdown notes.",
        "Rules:",
        "- Output ONLY the Markdown notes themselves. No preamble, no greeting, no sign-off, no commentary, no meta-explanations, no summary-of-a-summary.",
        '- NEVER address the user. Do not write "If you tell me more…", "If you can provide more context…", "Let me know if…", "I hope this helps", "Here are your notes", "Here\'s a summary of…", "Below is…", "Sure!", "Of course", "Based on the transcript…", "I can give you a more tailored…", or any similar conversational/meta text. The output goes directly into a notes app — there is no human reading a reply.',
        "- Do NOT ask for clarification or more context. If something is unclear, just capture what was said as faithfully as you can and move on. Never end with an offer to refine.",
        '- Do NOT produce a "summary of the talk" or "key themes and takeaways" frame around the notes. Just produce the notes directly.',
        "- Do NOT wrap the whole document in a code fence. Code fences are only for actual code/command snippets within the notes.",
        '- The first character of your response must be the first character of the notes (e.g. a "#" header or a "-" bullet) — not a sentence directed at the user.',
        "- The last character of your response must be the end of the notes — not an offer of further help.",
        "- Use headers, bullet lists, numbered lists, and code blocks where appropriate.",
        '- Remove filler words ("um", "uh", "like", "you know") and false starts.',
        '- The transcript comes from speech-to-text and the notes are about software development. It may contain phonetic errors where a word is split or replaced by similar-sounding words (e.g. "personal vision" → "personalization", "cuber net us" → "kubernetes", "type script" → "TypeScript", "re factor" → "refactor", "a sync" → "async", "Auth zero" → "Auth0", "Cee Eye Cee Dee" → "CI/CD"). When a phrase is awkward or out-of-place AND a similar-sounding technical/programming term fits the surrounding context clearly, substitute the intended term. Prefer dev/programming interpretations over generic English when both fit. If the intended word is not obvious from context, leave the text as-is rather than guessing.',
        "- Preserve the speaker's meaning faithfully — never invent facts or add content the transcript does not support.",
        "- Group related thoughts. Prefer concise, scannable notes over prose.",
        "- If existing notes are provided, integrate new content naturally — extend sections, add bullets where they fit, only create new headers when the topic genuinely shifts.",
        '- A `web_search` tool is available. ONLY call it when the user\'s background context explicitly asks you to search, look up, research, fetch, find, or otherwise supplement the notes with external information. If the context says nothing about searching, do NOT call any tools — just format the transcript. When you do call web_search, integrate the results into the notes naturally and cite sources inline as Markdown links (e.g. "React 19 introduces actions ([React blog](https://react.dev/blog/...))"). Do not paste raw URLs or dump a separate "Sources" section unless the context asks for one.',
        '- If a "Web search results" block is already provided in the user message (run on your behalf because the context asked for a lookup), use those facts to supplement the notes and cite them inline as Markdown links. Do NOT call web_search again for the same lookup — only call it if you genuinely need a different query.',
      ];

      if (hasContext) {
        systemRules.push(
          "- Background context is provided to help you interpret the transcript (jargon, domain, project names, etc.). Use it to disambiguate phonetic errors and choose better terminology. Do NOT include the context itself in the output — it is for your interpretation only.",
        );
      }

      if (hasImages) {
        systemRules.push(
          `- ${images.length} image(s) are attached, numbered starting from 1. A short description of each is provided in an "Attached images" block below — use those descriptions to decide where each image fits.`,
          "- Place each image in the note where it most naturally belongs based on what it shows AND the surrounding text. If an image illustrates a specific concept, put it directly under that section — different images can land in completely different parts of the note.",
          "- Reference each image with the literal placeholder syntax: ![short caption describing the image](image:N) — where N is the image number (1-indexed). Do NOT invent your own URL.",
          "- Every attached image must appear exactly once in the output, each on its own line.",
          "- The alt text / caption should briefly describe what is in the image (you can base it on the provided description).",
        );
      }

      const systemPrompt = systemRules.join("\n");

      // Deterministic pre-search: if the context explicitly asks Gemma to look
      // something up, run the searches now so the results are in the prompt
      // regardless of whether the local model template supports tool calling.
      if (hasContext) report("Reading your context…");
      const preSearchResults = hasContext
        ? await preSearchFromContext(context)
        : [];
      ensureLive();

      // Analyze each attached image on its own. Doing one vision pass per image
      // (instead of cramming them all into a single message) gives us a reliable,
      // numbered description for each — Gemma's multi-image binding is too weak to
      // tell image #1 from #3 when they're batched, which is what made placement of
      // several images degrade into a blurry dump. We place by description instead.
      if (hasImages) report("Looking at images…", `${images.length} attached`);
      const imageBase64 = hasImages
        ? await Promise.all(
            images.map(async (img) =>
              (await fs.readFile(img.path)).toString("base64"),
            ),
          )
        : [];
      const imageDescriptions = hasImages
        ? await Promise.all(imageBase64.map((b64) => describeImage(b64, token)))
        : [];
      ensureLive();

      const parts = [];
      if (hasContext) {
        parts.push(
          `Background context (for your interpretation only, do NOT echo into the notes):\n\n${context.trim()}`,
        );
        parts.push("---");
      }
      if (preSearchResults.length) {
        parts.push(formatPreSearchBlock(preSearchResults));
        parts.push("---");
      }
      if (hasImages) {
        const lines = [
          "Attached images (place each one where it fits best using ![caption](image:N)):",
        ];
        imageDescriptions.forEach((desc, index) => {
          lines.push(
            `[${index + 1}] ${desc || "image (no description available)"}`,
          );
        });
        parts.push(lines.join("\n"));
        parts.push("---");
      }
      if (existing && existing.trim()) {
        parts.push(`Existing notes:\n\n${existing}`);
        parts.push("---");
        parts.push(
          hasTranscript
            ? `New transcript to merge:\n\n${transcript}`
            : "(No new transcript — just place the attached images appropriately in the existing notes.)",
        );
      } else {
        parts.push(
          hasTranscript
            ? `Transcript:\n\n${transcript}`
            : "(No transcript — produce a brief note framed around the attached images.)",
        );
      }
      parts.push(
        hasImages
          ? `Return the complete updated Markdown notes with the ${images.length} attached image(s) inserted using the [image:N] placeholder syntax. Output ONLY the notes — no greeting, no commentary, no "here's your notes" preamble.`
          : 'Return the complete updated Markdown notes. Output ONLY the notes — no greeting, no commentary, no "here\'s your notes" preamble.',
      );

      // The formatting pass is text-only: each image is already analyzed above and
      // represented by its numbered description, so Gemma places by content rather
      // than re-deriving it from a hard-to-disambiguate batch of raw images.
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: parts.join("\n\n") },
      ];

      // Push a throttled live snippet of the latest generated text to the renderer
      // so the user can see Gemma is actively writing, not stuck.
      let lastSentLength = 0;
      const onProgress = (full) => {
        if (full.length - lastSentLength < 24) return;
        lastSentLength = full.length;
        const tail = full.replace(/\s+/g, " ").trim().slice(-90);
        report("Writing your notes…", tail);
      };

      report("Reading your notes…");
      let out = "";
      const MAX_TURNS = 4;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        ensureLive();
        const message = await streamChat({
          messages,
          tools: [WEB_SEARCH_TOOL],
          options: { temperature: 0.2 },
          token,
          onProgress,
        });

        const toolCalls = message.tool_calls || [];

        if (toolCalls.length === 0) {
          out = message.content;
          break;
        }

        // Keep the assistant turn (with tool_calls) in history, then run each tool
        // and append a tool-role message with the result.
        messages.push(message);
        report("Searching the web…");
        for (const call of toolCalls) {
          const name = call.function?.name;
          const result = await executeToolCall(name, call.function?.arguments);
          messages.push({ role: "tool", name, content: result });
        }

        // If this was the last allowed turn, force one more chat call so the model
        // can synthesize the final notes from the tool results.
        if (turn === MAX_TURNS - 1) {
          ensureLive();
          report("Writing your notes…");
          const finalMessage = await streamChat({
            messages,
            options: { temperature: 0.2 },
            token,
            onProgress,
          });
          out = finalMessage.content;
        }
      }
      out = stripConversational(out);

      if (hasImages) {
        // Resolve [image:N] / image:N placeholders to real note-image:// URLs.
        out = out.replace(/\(image:(\d+)\)/g, (full, numberText) => {
          const index = parseInt(numberText, 10) - 1;
          const img = images[index];
          return img ? `(${img.url})` : full;
        });
        // Fallback: append any images Gemma forgot to place, captioned with the
        // description we generated for them.
        for (let index = 0; index < images.length; index++) {
          if (!out.includes(images[index].url)) {
            const caption =
              imageDescriptions[index] || `attached image ${index + 1}`;
            out += `\n\n![${caption}](${images[index].url})`;
          }
        }
      }

      return out;
    } finally {
      if (activeFormatToken === token) activeFormatToken = null;
    }
  },
);

// Run a single-image vision pass so each attachment gets its own concise
// description. Done per image (rather than batching) because the local vision
// model can't reliably tell several batched images apart — analyzing them one at
// a time is what lets the formatter place each one in the right spot. Best-effort:
// on any failure we return '' and the formatter falls back to generic captions.
async function describeImage(base64, token) {
  try {
    const message = await streamChat({
      messages: [
        {
          role: "system",
          content:
            "You describe images for placement in technical software-development notes. " +
            "Reply with ONE concise sentence (no preamble) describing what the image shows — " +
            "e.g. a diagram, screenshot, chart, code, whiteboard, or UI — and its key subject.",
        },
        { role: "user", content: "Describe this image.", images: [base64] },
      ],
      options: { temperature: 0.1 },
      token,
    });
    return message.content.replace(/\s+/g, " ");
  } catch (err) {
    // Let a deliberate cancel bubble up; swallow only real description failures.
    if (err instanceof FormatCancelled) throw err;
    return "";
  }
}

// ---- Web search tool (Gemma can call this during formatting) ----

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web (DuckDuckGo) for current information. Returns up to 5 results with title, URL, and snippet. ONLY use this when the user's background context explicitly asks you to search, look up, research, fetch, find, or supplement the notes with external information. Do not call it otherwise.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A concise search query, like what you would type into a search engine.",
        },
      },
      required: ["query"],
    },
  },
};

// Phrases in the user's context that mean "go search for something" — used to
// fire pre-searches for models whose Ollama template doesn't expose tool
// calling (e.g. some custom Gemma builds).
const SEARCH_TRIGGER_RE =
  /\b(?:search(?:\s+(?:for|the\s+web|online))?|look(?:\s+(?:up|into))?|looked\s+up|research|google|fetch|pull\s+up|find\s+(?:info|information|details|out\s+(?:about|what))|check\s+(?:what|whether|if)|investigate|cite\s+sources?\s+for|reference|what\s+is|who\s+is|tell\s+me\s+about)\b/i;

// Try to extract a focused query from a sentence that contains a search verb.
// Falls back to the whole sentence if the heuristic doesn't fire.
function extractQueryFromSentence(sentence) {
  const trimmed = sentence.trim().replace(/[.!?]+$/, "");
  const match = trimmed.match(
    /(?:search(?:\s+(?:for|the\s+web|online))?|look(?:\s+(?:up|into))?|research|google|fetch|pull\s+up|find\s+(?:info|information|details)\s+(?:on|about|for)|investigate|cite\s+sources?\s+for|reference|what\s+is|who\s+is|tell\s+me\s+about)\s+(.+?)(?:\s+and\s+(?:add|summarize|include|then)\b.*)?$/i,
  );
  const raw = match ? match[1] : trimmed;
  // Strip leading articles and trailing instruction-y tails.
  return raw
    .replace(/^(?:the|an|a)\s+/i, "")
    .replace(/\s+then\s+.+$/i, "")
    .replace(/\s+and\s+(?:add|summarize|include).*$/i, "")
    .trim()
    .slice(0, 200);
}

async function preSearchFromContext(context) {
  if (!context || !SEARCH_TRIGGER_RE.test(context)) return [];

  // Break into clauses on sentence boundaries OR explicit "and"/"then" joins,
  // then pick the ones that contain a search verb.
  const clauses = context
    .split(/(?<=[.!?])\s+|\n+|;\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const queries = [];
  const seen = new Set();
  for (const clause of clauses) {
    if (!SEARCH_TRIGGER_RE.test(clause)) continue;
    const query = extractQueryFromSentence(clause);
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
    if (queries.length >= 3) break;
  }
  if (!queries.length) return [];

  const out = [];
  for (const query of queries) {
    try {
      const hits = await webSearch(query, 4);
      out.push({ query, hits });
    } catch (err) {
      out.push({ query, error: err.message });
    }
  }
  return out;
}

function formatPreSearchBlock(searches) {
  const lines = [
    "Web search results (run on your behalf because the context asked for lookups — use these to supplement the notes, and cite each source you use inline as a Markdown link):",
    "",
  ];
  for (const { query, hits, error } of searches) {
    lines.push(`Search: "${query}"`);
    if (error) {
      lines.push(`  (search failed: ${error})`);
    } else if (!hits || !hits.length) {
      lines.push("  (no results)");
    } else {
      for (let index = 0; index < hits.length; index++) {
        const hit = hits[index];
        lines.push(`  [${index + 1}] ${hit.title}`);
        lines.push(`      ${hit.url}`);
        if (hit.snippet) lines.push(`      ${hit.snippet}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function executeToolCall(name, rawArgs) {
  if (name !== "web_search") return `Unknown tool: ${name}`;

  // Ollama may return arguments as an object or as a JSON string.
  let args = rawArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { query: args };
    }
  }
  const query = String(args?.query || "")
    .trim()
    .slice(0, 250);
  if (!query) return "web_search error: empty query.";

  try {
    const hits = await webSearch(query, 5);
    if (!hits.length) return `web_search("${query}") returned no results.`;
    return hits
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.title}\nURL: ${hit.url}\n${hit.snippet}`,
      )
      .join("\n\n");
  } catch (err) {
    return `web_search("${query}") failed: ${err.message}`;
  }
}

async function webSearch(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  const resultPattern =
    /<a\s+[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\s+[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while (
    (match = resultPattern.exec(html)) !== null &&
    results.length < maxResults
  ) {
    let href = match[1];
    // DDG wraps results in a /l/?uddg=<encoded> redirect — unwrap to the real URL.
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    const title = stripHtml(match[2]);
    const snippet = stripHtml(match[3]);
    if (title && href) results.push({ title, url: href, snippet });
  }
  return results;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip conversational fluff Gemma sometimes prepends/appends despite being told
// not to: "Here are your notes…", "If you'd like more detail…", "Hope this helps!",
// outer ``` fences wrapping the whole document, etc.
function stripConversational(text) {
  let result = text.trim();

  // Drop an outer triple-backtick fence wrapping the entire response.
  const fence = result.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) result = fence[1].trim();

  const leadPatterns = [
    /^(?:sure|of course|certainly|absolutely|got it|okay|ok|alright|great)[!.,:]*\s*/i,
    /^(?:here(?:'s| is| are)[^\n]*?(?:notes?|markdown|formatted)[^\n]*?[:.\n])\s*/i,
    /^(?:based on (?:the|your)[^\n]*?(?:transcript|notes?|context)[^\n]*?[:.\n])\s*/i,
    /^(?:i(?:'ve| have)[^\n]*?(?:formatted|organized|cleaned up|merged|updated)[^\n]*?[:.\n])\s*/i,
    /^(?:below (?:is|are)[^\n]*?[:.\n])\s*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadPatterns) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next.trimStart();
        changed = true;
      }
    }
  }

  const tailPatterns = [
    /\n+(?:i hope (?:this|that) helps[^\n]*)$/i,
    /\n+(?:hope (?:this|that) helps[^\n]*)$/i,
    /\n+(?:let me know if[^\n]*)$/i,
    /\n+(?:if you(?:'d| would)? like[^\n]*(?:more|further|additional)[^\n]*)$/i,
    /\n+(?:if you (?:can )?(?:tell|give|share|provide)[^\n]*(?:more|additional)[^\n]*)$/i,
    /\n+(?:feel free to[^\n]*)$/i,
    /\n+(?:would you like[^\n]*)$/i,
  ];
  changed = true;
  while (changed) {
    changed = false;
    for (const pattern of tailPatterns) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next.trimEnd();
        changed = true;
      }
    }
  }

  return result.trim();
}

ipcMain.handle("llm:check", async () => {
  try {
    const models = await ollama.list();
    const has = models.models?.some((model) =>
      model.name.startsWith(OLLAMA_MODEL),
    );
    return { ok: true, hasModel: !!has, model: OLLAMA_MODEL };
  } catch (err) {
    return { ok: false, error: err.message, model: OLLAMA_MODEL };
  }
});
