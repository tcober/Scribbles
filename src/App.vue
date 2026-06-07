<template>
  <div class="app">
    <Sidebar
      :notes="notes"
      :active-id="activeNote?.id"
      :disabled="status === 'recording'"
      @select="selectNote"
      @create="createNote"
      @delete="deleteNote"
      @reveal="revealNotesFolder"
    />

    <main class="main">
      <header v-if="llmStatus && !llmStatus.ok" class="warning">
        Cannot reach Ollama. Start it (menubar app or <code>ollama serve</code>)
        and pull the model:
        <code>ollama pull {{ llmStatus?.model || "gemma4" }}</code
        >.
      </header>
      <header v-else-if="llmStatus && !llmStatus.hasModel" class="warning">
        Ollama is running but model <code>{{ llmStatus.model }}</code> is not
        installed. Pull it: <code>ollama pull {{ llmStatus.model }}</code
        >.
      </header>

      <NoteEditor
        v-if="activeNote"
        :note="activeNote"
        :rendered="renderedMarkdown"
        :status="status"
        :error="errorMessage"
        :pending-images="pendingImages"
        :max-images="MAX_IMAGES_PER_FORMAT"
        :format-progress="formatProgress"
        :transcribing="isTranscribing"
        :starting="isStarting"
        @title="saveTitle"
        @markdown="saveMarkdown"
        @context="saveContext"
        @toggle="toggleRecording"
        @attach-images="handleImageFiles"
        @remove-image="removePendingImage"
        @format="runFormat"
        @cancel-format="cancelFormat"
      />

      <div v-else class="empty">
        <h1>Scribbles</h1>
        <p>Create a new note and hit <strong>Start listening</strong>.</p>
        <p>
          Audio is transcribed locally. Drop in up to
          {{ MAX_IMAGES_PER_FORMAT }} images and Gemma 4 will place them in the
          right spots when it formats.
        </p>
        <button class="primary" @click="createNote">+ New note</button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from "vue";
import { marked } from "marked";
import Sidebar from "./components/Sidebar.vue";
import NoteEditor from "./components/NoteEditor.vue";
import { Recorder } from "./utils/recorder.js";

const notes = ref([]);
const activeNote = ref(null);
const status = ref("idle"); // idle | recording | formatting | error
const errorMessage = ref("");
const llmStatus = ref(null);
// Live progress for the current format: { stage, detail }. Null when idle.
const formatProgress = ref(null);

// Number of audio chunks currently being transcribed by whisper. Drives the
// "Transcribing…" indicator so the user sees work is happening before the first
// words land, and while a just-stopped recording finishes its final chunk.
const pendingTranscriptions = ref(0);
const isTranscribing = computed(() => pendingTranscriptions.value > 0);
// True only while the mic/AudioContext is being acquired, so the record button
// can react to the click immediately instead of waiting for getUserMedia.
const isStarting = ref(false);

// Images attached since the last format pass. Cleared after Gemma places them.
const pendingImages = ref([]);

// Cap how many images can ride along with a single format pass.
const MAX_IMAGES_PER_FORMAT = 3;

// Cap how much of the already-formatted note we re-send to Gemma each format.
// Sending the whole note every time grows the prompt (and Gemma's KV-cache
// memory) without bound as it gets longer — the main thing that pushes a low-RAM
// Mac into swap mid-format. We keep everything before a clean markdown boundary
// verbatim ("head") and only hand Gemma the recent tail as context, so it can
// still merge new speech into the latest section seamlessly.
const MAX_FORMAT_CONTEXT_CHARS = 2000;

function splitFormatContext(formatted) {
  if (formatted.length <= MAX_FORMAT_CONTEXT_CHARS) {
    return { head: "", tail: formatted };
  }
  const target = formatted.length - MAX_FORMAT_CONTEXT_CHARS;
  // Prefer to start the tail at a heading so Gemma gets a coherent section;
  // fall back to a paragraph break, then a hard cut as a last resort.
  let splitIndex = formatted.indexOf("\n#", target);
  if (splitIndex !== -1) {
    splitIndex += 1; // start the tail at the '#'
  } else {
    splitIndex = formatted.indexOf("\n\n", target);
    splitIndex = splitIndex === -1 ? target : splitIndex + 2;
  }
  return {
    head: formatted.slice(0, splitIndex).trimEnd(),
    tail: formatted.slice(splitIndex).trimStart(),
  };
}

const recorder = new Recorder();

let sessionStartIndex = 0;
let transcribeChain = Promise.resolve();
// Tail of the transcript so far, fed back into the next chunk as whisper context.
let carryover = "";
// Detaches the llm:format-progress IPC listener on unmount.
let unsubscribeFormatProgress = null;

const renderedMarkdown = computed(() =>
  activeNote.value ? marked.parse(activeNote.value.markdown || "") : "",
);

const plain = (obj) => JSON.parse(JSON.stringify(obj));

async function refreshNotes() {
  notes.value = await window.api.listNotes();
}

async function selectNote(id) {
  if (status.value === "recording") return;
  activeNote.value = await window.api.loadNote(id);
  pendingImages.value = [];
}

async function createNote() {
  if (status.value === "recording") return;
  const created = await window.api.createNote("Untitled note");
  await refreshNotes();
  activeNote.value = created;
  pendingImages.value = [];
}

async function deleteNote(id) {
  if (status.value === "recording") return;
  await window.api.deleteNote(id);
  if (activeNote.value?.id === id) {
    activeNote.value = null;
    pendingImages.value = [];
  }
  await refreshNotes();
}

async function saveTitle(title) {
  if (!activeNote.value) return;
  activeNote.value.title = title;
  await window.api.saveNote(plain(activeNote.value));
  await refreshNotes();
}

let markdownSaveTimer = null;
function saveMarkdown(markdown) {
  if (!activeNote.value) return;
  activeNote.value.markdown = markdown;
  clearTimeout(markdownSaveTimer);
  markdownSaveTimer = setTimeout(async () => {
    if (!activeNote.value) return;
    await window.api.saveNote(plain(activeNote.value));
  }, 400);
}

let contextSaveTimer = null;
function saveContext(context) {
  if (!activeNote.value) return;
  activeNote.value.context = context;
  clearTimeout(contextSaveTimer);
  contextSaveTimer = setTimeout(async () => {
    if (!activeNote.value) return;
    await window.api.saveNote(plain(activeNote.value));
  }, 400);
}

async function toggleRecording() {
  if (status.value === "formatting") return;
  if (!activeNote.value) await createNote();
  if (status.value === "recording") {
    await stopRecording();
  } else {
    await startRecording();
  }
}

function appendToNote(text) {
  if (!activeNote.value || !text) return;
  const sep =
    activeNote.value.markdown && !activeNote.value.markdown.endsWith("\n\n")
      ? "\n\n"
      : "";
  activeNote.value.markdown = (activeNote.value.markdown || "") + sep + text;
}

function handleChunk(wav) {
  pendingTranscriptions.value++;
  transcribeChain = transcribeChain.then(async () => {
    try {
      const text = await window.api.transcribe(wav, { carryover });
      if (!text) return;
      appendToNote(text);
      // Carry the most recent words into the next chunk for cross-chunk context.
      carryover = `${carryover} ${text}`.slice(-600);
      await window.api.saveNote(plain(activeNote.value));
    } catch (err) {
      errorMessage.value = err.message || String(err);
    } finally {
      pendingTranscriptions.value--;
    }
  });
}

async function startRecording() {
  errorMessage.value = "";
  isStarting.value = true;
  sessionStartIndex = (activeNote.value?.markdown || "").length;
  carryover = "";
  try {
    await recorder.start({
      onChunk: handleChunk,
      chunkSeconds: 15,
      // Get the first words on screen quickly; later chunks use the full cadence.
      firstChunkSeconds: 5,
    });
    status.value = "recording";
  } catch (err) {
    status.value = "error";
    errorMessage.value = `Could not access microphone: ${err.message}`;
  } finally {
    isStarting.value = false;
  }
}

async function stopRecording() {
  try {
    await recorder.stop();
  } catch (err) {
    status.value = "error";
    errorMessage.value = `Recording failed: ${err.message}`;
    return;
  }
  // Leave the "recording" state right away so the button stops feeling stuck.
  // The final chunk finishes transcribing in the background — isTranscribing
  // keeps the footer showing "Transcribing…" until it lands.
  status.value = "idle";
  const draining = transcribeChain;
  draining.finally(() => {
    if (transcribeChain === draining) transcribeChain = Promise.resolve();
  });
}

// Run Gemma over the new raw transcript + any pending images, integrating with
// already-formatted content. Triggered by the standalone "Format with Gemma" button.
async function runFormat() {
  const note = activeNote.value;
  if (!note) return;
  if (status.value !== "idle") return;

  // Claim the formatting state synchronously, BEFORE any await, so a second
  // trigger can't slip past the guard above while we wait below — two concurrent
  // Gemma generations would mean two model loads and can swap the machine.
  status.value = "formatting";
  formatProgress.value = { stage: "Starting…", detail: "" };

  // A just-stopped recording may still have a final chunk in flight; wait for it
  // so the transcript Gemma sees is complete. Safe now that status is already
  // "formatting" (whisper has already finished by the time we read note.markdown,
  // so Gemma never runs concurrently with a transcription).
  if (pendingTranscriptions.value > 0) await transcribeChain;

  const full = note.markdown || "";
  const newRaw = full.slice(sessionStartIndex).trim();
  const previouslyFormatted = full.slice(0, sessionStartIndex).trimEnd();
  const imgs = pendingImages.value.slice();
  const context = (note.context || "").trim();

  if (!newRaw && imgs.length === 0) {
    status.value = "idle";
    formatProgress.value = null;
    return;
  }

  // Only re-send a bounded recent slice of the formatted note. Everything before
  // the split stays verbatim and is stitched back on after Gemma returns, so the
  // prompt size (and memory) stays flat no matter how long the note gets.
  const { head: formattedHead, tail: formattedTail } =
    splitFormatContext(previouslyFormatted);

  try {
    const updated = await window.api.formatNote({
      transcript: newRaw,
      existing: formattedTail,
      context,
      images: imgs.map(({ filename, url, path, mime }) => ({
        filename,
        url,
        path,
        mime,
      })),
    });
    note.markdown = formattedHead ? `${formattedHead}\n\n${updated}` : updated;
    // Context is per-format-run: clear it so the panel collapses and the next
    // run starts fresh.
    note.context = "";
    clearTimeout(contextSaveTimer);
    await window.api.saveNote(plain(note));
    activeNote.value = { ...note };
    await refreshNotes();
    sessionStartIndex = note.markdown.length;
    pendingImages.value = [];
    status.value = "idle";
  } catch (err) {
    // A user-initiated cancel is not an error — leave the note untouched and
    // return to idle quietly. Everything else surfaces as an error.
    if ((err.message || "").includes("FORMAT_CANCELLED")) {
      status.value = "idle";
    } else {
      status.value = "error";
      errorMessage.value = err.message || String(err);
    }
  } finally {
    formatProgress.value = null;
  }
}

// Ask the main process to abort the in-progress format. runFormat's catch then
// resolves the cancellation back to idle.
function cancelFormat() {
  if (status.value !== "formatting") return;
  formatProgress.value = { stage: "Cancelling…", detail: "" };
  window.api.cancelFormat();
}

// Convert a File or Blob to a data URL, then ship to main for on-disk storage.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleImageFiles(files) {
  const remaining = MAX_IMAGES_PER_FORMAT - pendingImages.value.length;
  if (remaining <= 0) {
    errorMessage.value = `You can attach up to ${MAX_IMAGES_PER_FORMAT} images per format.`;
    return;
  }

  const incoming = Array.from(files).filter(
    (file) => file && file.type?.startsWith("image/"),
  );
  if (incoming.length > remaining) {
    errorMessage.value = `Only ${remaining} more image${remaining === 1 ? "" : "s"} can be added (limit ${MAX_IMAGES_PER_FORMAT} per format).`;
  }
  const accepted = incoming.slice(0, remaining);

  if (!activeNote.value) await createNote();
  for (const file of accepted) {
    try {
      const dataUrl = await fileToDataUrl(file);
      const img = await window.api.addImage({
        noteId: activeNote.value.id,
        dataUrl,
      });
      pendingImages.value.push(img);
    } catch (err) {
      errorMessage.value = `Could not attach image: ${err.message}`;
    }
  }
}

async function removePendingImage(filename) {
  const index = pendingImages.value.findIndex(
    (image) => image.filename === filename,
  );
  if (index === -1) return;
  const img = pendingImages.value[index];
  pendingImages.value.splice(index, 1);
  await window.api.deleteImage({
    noteId: activeNote.value.id,
    filename: img.filename,
  });
}

async function revealNotesFolder() {
  try {
    await window.api.revealNotesFolder();
  } catch (err) {
    errorMessage.value = err?.message || String(err);
    console.error("revealNotesFolder failed:", err);
  }
}

// Paste a screenshot anywhere to attach it. Named (not inline) so the same
// reference can be removed on unmount.
function handlePaste(event) {
  if (!event.clipboardData) return;
  const items = Array.from(event.clipboardData.items).filter((item) =>
    item.type.startsWith("image/"),
  );
  if (!items.length) return;
  const files = items.map((item) => item.getAsFile()).filter(Boolean);
  if (files.length) handleImageFiles(files);
}

onMounted(async () => {
  await refreshNotes();
  llmStatus.value = await window.api.checkLlm();

  // Reflect Gemma's live progress while a format runs. Ignore late updates that
  // arrive after we've already left the formatting state (e.g. post-cancel).
  // Keep the unsubscribe so we can detach on unmount (and avoid duplicate
  // listeners piling up across Vite HMR reloads during development).
  unsubscribeFormatProgress = window.api.onFormatProgress((payload) => {
    if (status.value === "formatting") formatProgress.value = payload;
  });

  // Global paste handler — paste a screenshot anywhere to attach it.
  window.addEventListener("paste", handlePaste);
});

onBeforeUnmount(() => {
  unsubscribeFormatProgress?.();
  unsubscribeFormatProgress = null;
  window.removeEventListener("paste", handlePaste);
  clearTimeout(markdownSaveTimer);
  clearTimeout(contextSaveTimer);
});
</script>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.warning {
  background: #3a2418;
  color: #f3c98b;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #5a3a22;
  font-size: 0.85rem;
}
.warning code {
  background: #2a1810;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #8a93a6;
  gap: 0.6rem;
}
.empty h1 {
  color: #e8ecf4;
  margin-bottom: 0.5rem;
}
.empty .primary {
  margin-top: 1.5rem;
  padding: 0.7rem 1.4rem;
  font-size: 1rem;
  background: #4c8bf5;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.empty .primary:hover {
  background: #6aa0ff;
}
</style>
