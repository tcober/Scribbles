# Local Note Taker

Electron + Vue 3 desktop app that records your microphone, transcribes it locally with **Whisper** (whisper.cpp), and formats the transcript into clean Markdown notes using **Gemma 4** via [Ollama](https://ollama.com). You can also drop or paste images into a note (Gemma's vision places them where they belong) and give Gemma background context for a formatting pass — including asking it to search the web. Nothing leaves your machine except web searches you explicitly request.

Built and tested for **macOS on Apple Silicon** (arm64). Whisper runs on the GPU via Metal.

## Download & install (end users)

> You only need **[Ollama](https://ollama.com)** installed — the Whisper transcription engine is bundled inside the app.

1. Download the latest `LocalNoteTaker-<version>-arm64.dmg` from the [Releases](https://github.com/YOUR_GITHUB_USERNAME/local-note-taker/releases) page (Apple Silicon only).
2. Open the `.dmg` and drag **Local Note Taker** into Applications.
3. The app is **not notarized by Apple**, so Gatekeeper blocks it on first launch. Clear the download quarantine once:
   ```bash
   xattr -cr "/Applications/Local Note Taker.app"
   ```
   then open it normally. (Or: right-click the app → **Open** → **Open**.)
4. Install [Ollama](https://ollama.com), then pull the model it formats with:
   ```bash
   ollama pull gemma4
   ```

Recording, transcription, and formatting all run locally; only web searches you explicitly request leave your machine.

## Prerequisites (building from source)

1. **Node.js 20+** (`brew install node`)
2. **Ollama** — runs Gemma locally. Make sure `ollama serve` (or the menubar app) is running and that you've pulled `gemma4`:
   ```bash
   ollama pull gemma4
   ```
   Override the model name with `NOTE_TAKER_MODEL=<model-name>` if you want a different tag (e.g. `NOTE_TAKER_MODEL=gemma4:12b npm run dev`).
3. **A `whisper-cli` binary** for local transcription — either build the bundled static copy or install it system-wide:
   ```bash
   npm run vendor:whisper   # builds a self-contained whisper-cli (needs cmake: brew install cmake)
   # …or…
   brew install whisper-cpp # use the Homebrew binary from your PATH instead
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

## Build & release

The app ships as an **unsigned, ad-hoc-signed** arm64 `.dmg`/`.zip` with a
self-contained `whisper-cli` bundled inside (no Homebrew needed on the user's
machine), built with [electron-builder](https://www.electron.build).

```bash
npm run build   # just bundle the Vue UI into dist/
npm start       # run that production bundle locally via Electron

npm run dist    # vendor whisper-cli + build dist/ + produce release/*.dmg and *.zip
```

`npm run dist` (and `pack`/`release`) first run `npm run vendor:whisper`, which
builds a static `whisper-cli` from whisper.cpp `v1.8.4` into `resources/whisper/`.
The `afterPack` hook then ad-hoc-signs the bundle so it launches on Apple Silicon
despite being unsigned.

### Publishing to GitHub Releases

1. Set the real repo in `package.json` → `"repository".url` (replace `YOUR_GITHUB_USERNAME`).
2. Bump `"version"`, commit, then tag: `git tag v0.1.0 && git push --tags`.
3. Either let CI publish (push the tag — `.github/workflows/release.yml` builds on a
   macOS runner and uploads to the matching release), or publish from your machine:
   ```bash
   export GH_TOKEN=<a GitHub personal access token with "repo" scope>
   npm run release
   ```

> **Signing note:** with no Apple Developer ID, downloaders must clear the
> quarantine flag once (see _Download & install_ above). If you later get a
> Developer ID, set `mac.identity`, drop the `afterPack` ad-hoc hook, and add
> notarization to remove that step.

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

| Variable                    | Default                  | Purpose                                                                                                            |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `NOTE_TAKER_MODEL`          | `gemma4`                 | Ollama model name used for formatting.                                                                             |
| `NOTE_TAKER_WHISPER_MODEL`  | `large-v3-turbo`         | Whisper model (tiny.en, base.en, small.en, medium.en, large-v3-turbo, large-v3). Bigger = slower + more accurate.  |
| `NOTE_TAKER_WHISPER_BIN`    | _(bundled binary)_       | Path to the whisper-cli binary. Overrides the bundled/vendored one — handy for a custom build or off-PATH install. |
| `NOTE_TAKER_WHISPER_PROMPT` | _(dev-notes hint)_       | Initial prompt fed to Whisper to bias word choice toward your domain. Defaults to a software-development hint.     |
| `OLLAMA_HOST`               | `http://127.0.0.1:11434` | Where to reach Ollama.                                                                                             |

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
- **"Could not find the whisper-cli binary"** (dev only): run `npm run vendor:whisper`, or `brew install whisper-cpp`. To point at a custom build, set `NOTE_TAKER_WHISPER_BIN=/full/path/to/whisper-cli`. Released builds bundle this binary, so end users never hit this.
- **"App is damaged" / "can't be opened"** on a downloaded build: clear the quarantine flag — `xattr -cr "/Applications/Local Note Taker.app"` — then open again. Expected for an unsigned, un-notarized app.
- **No microphone access**: System Settings → Privacy & Security → Microphone → enable for Electron (or Terminal during dev).
