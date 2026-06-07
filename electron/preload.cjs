const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listNotes: () => ipcRenderer.invoke("notes:list"),
  loadNote: (id) => ipcRenderer.invoke("notes:load", id),
  createNote: (title) => ipcRenderer.invoke("notes:create", title),
  saveNote: (note) => ipcRenderer.invoke("notes:save", note),
  deleteNote: (id) => ipcRenderer.invoke("notes:delete", id),
  revealNotesFolder: () => ipcRenderer.invoke("notes:revealFolder"),

  addImage: (payload) => ipcRenderer.invoke("images:add", payload),
  deleteImage: (payload) => ipcRenderer.invoke("images:delete", payload),

  transcribe: (wavArrayBuffer, opts) =>
    ipcRenderer.invoke("audio:transcribe", wavArrayBuffer, opts),
  formatNote: (payload) => ipcRenderer.invoke("llm:format", payload),
  placeImages: (payload) => ipcRenderer.invoke("llm:place-images", payload),
  cancelFormat: () => ipcRenderer.invoke("llm:cancel-format"),
  // Subscribe to live progress updates emitted during a format. Returns an
  // unsubscribe function so the caller can detach the listener.
  onFormatProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("llm:format-progress", listener);
    return () => ipcRenderer.removeListener("llm:format-progress", listener);
  },
  checkLlm: () => ipcRenderer.invoke("llm:check"),
});
