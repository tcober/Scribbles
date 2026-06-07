import { vi } from "vitest";

// The renderer talks to the main process through window.api (exposed by
// electron/preload.cjs). That bridge doesn't exist under jsdom, so stub every
// method as a vi.fn(). Individual tests override the ones they care about via
// window.api.<method>.mockResolvedValue(...).
globalThis.window.api = {
  listNotes: vi.fn().mockResolvedValue([]),
  loadNote: vi.fn().mockResolvedValue(null),
  createNote: vi.fn().mockResolvedValue(null),
  saveNote: vi.fn().mockResolvedValue(undefined),
  deleteNote: vi.fn().mockResolvedValue(undefined),
  revealNotesFolder: vi.fn().mockResolvedValue(undefined),
  addImage: vi.fn().mockResolvedValue(null),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  transcribe: vi.fn().mockResolvedValue(""),
  formatNote: vi.fn().mockResolvedValue(""),
  placeImages: vi.fn().mockResolvedValue(""),
  cancelFormat: vi.fn().mockResolvedValue(undefined),
  onFormatProgress: vi.fn().mockReturnValue(() => {}),
  checkLlm: vi.fn().mockResolvedValue(null),
};
