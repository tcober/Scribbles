# Local Note Taker

Electron + Vue 3 desktop app that records your microphone, transcribes it locally with **Whisper** (whisper.cpp), and formats the transcript into clean Markdown notes using **Gemma 4** via [Ollama](https://ollama.com). You can also drop or paste images into a note (Gemma's vision places them where they belong) and give Gemma background context for a formatting pass — including asking it to search the web. Nothing leaves your machine except web searches you explicitly request.

Built and tested for **macOS** (Apple Silicon recommended for fast Whisper inference via Metal).

## Prerequisites

1. **Node.js 20+** (`brew install node`)
2. **Ollama** — runs Gemma locally. Make sure `ollama serve` (or the menubar app) is running and that you've pulled `gemma4`:
   ```bash
   ollama pull gemma4
   ```
   Override the model name with `NOTE_TAKER_MODEL=<model-name>` if you want a different tag (e.g. `NOTE_TAKER_MODEL=gemma4:12b npm run dev`).
3. **whisper.cpp** (provides the `whisper-cli` binary for local transcription):
   ```bash
   brew install whisper-cpp
   ```

## Install

```bash
cd "Note Taker"
npm install
```

On first transcription, the Whisper `large-v3-turbo` model (~1.6 GB) is downloaded to `~/Library/Application Support/local-note-taker/models/`. Subsequent runs reuse it. Set `NOTE_TAKER_WHISPER_MODEL` to a smaller model (e.g. `small.en`) if you want a lighter download.

## Run (dev)

```bash
npm run dev
```

Vite serves the Vue UI on `:5173`; Electron loads it with DevTools attached.

## Build (prod)

```bash
npm run build   # bundles the Vue app into dist/
npm start       # launches Electron pointing at dist/
```

## Usage

1. Click **+ New** in the sidebar to create a fresh note.
2. Click **Start listening** in the bottom right. Grant mic permission the first time.
3. Speak. The transcript appears live as Whisper decodes each chunk.
4. (Optional) Drag-and-drop or paste images into the note body, and add background
   context in the **Context** panel — jargon, what the meeting is about, or an
   explicit request to search the web for something.
5. Click **Format with Gemma**. Gemma turns the raw transcript into clean Markdown,
   merges it into any already-formatted content, places your images where they fit,
   and — only if your context asks for it — searches the web (DuckDuckGo) to
   supplement the notes.
6. Press **Start listening** again at any time to extend the note.
7. Click **Show in Finder** in the sidebar to open the on-disk note folder.

Notes live as `.json` files at:
```
~/Library/Application Support/local-note-taker/notes/
```

## Configuration

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `NOTE_TAKER_MODEL` | `gemma4` | Ollama model name used for formatting. |
| `NOTE_TAKER_WHISPER_MODEL` | `large-v3-turbo` | Whisper model (tiny.en, base.en, small.en, medium.en, large-v3-turbo, large-v3). Bigger = slower + more accurate. |
| `NOTE_TAKER_WHISPER_BIN` | `whisper-cli` | Path to the whisper.cpp binary. Override if you installed it somewhere off-PATH. |
| `NOTE_TAKER_WHISPER_PROMPT` | _(dev-notes hint)_ | Initial prompt fed to Whisper to bias word choice toward your domain. Defaults to a software-development hint. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Where to reach Ollama. |

Example: `NOTE_TAKER_WHISPER_MODEL=small.en npm run dev`

## Architecture

```
┌──────────────────────────────── Electron ─────────────────────────────────┐
│                                                                            │
│  Renderer (Vue 3)                Main (Node)                               │
│  ────────────────                ──────────────                            │
│  Mic → AudioContext              IPC: audio:transcribe →                   │
│  → 16 kHz WAV  ────────────────► /tmp/*.wav → whisper-cli (brew) → text    │
│                                                                            │
│  transcript ◄─────────────────── IPC return                                │
│                                                                            │
│  IPC: llm:format(transcript, ──► Ollama HTTP (127.0.0.1:11434)             │
│   existing md, images, context) gemma4 (vision) → formatted Markdown       │
│                                  │  ▲                                       │
│                                  └──┘ web_search tool → DuckDuckGo          │
│                                  (only when context asks for it)           │
│                                                                            │
│  marked.parse() → preview                                                  │
│  save → IPC notes:save → ~/Library/Application Support/.../notes/*.json    │
└────────────────────────────────────────────────────────────────────────────┘
```

## Troubleshooting

- **"Cannot reach Ollama"**: run `ollama serve` or open the Ollama menubar app.
- **"model not installed"**: `ollama pull gemma4`.
- **"Could not find whisper-cli"**: `brew install whisper-cpp`. If installed off-PATH, set `NOTE_TAKER_WHISPER_BIN=/full/path/to/whisper-cli`.
- **No microphone access**: System Settings → Privacy & Security → Microphone → enable for Electron (or Terminal during dev).
