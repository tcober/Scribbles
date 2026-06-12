// IPC handlers for note CRUD: each note is a JSON file under userData/notes, plus
// a "reveal in Finder" helper.
import { ipcMain, shell } from "electron";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";

import { assertSafeId, ensureDirs, notesDir } from "../paths.js";

export function registerNoteHandlers() {
  ipcMain.handle("notes:list", async () => {
    await ensureDirs();
    const dir = notesDir();
    const files = await fs.readdir(dir);
    const notes = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(join(dir, file), "utf8");
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
    assertSafeId(id);
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
    assertSafeId(note?.id);
    // Don't mutate the caller's object; stamp the save time on a copy.
    const saved = { ...note, updatedAt: Date.now() };
    await fs.writeFile(
      join(notesDir(), `${saved.id}.json`),
      JSON.stringify(saved, null, 2),
    );
    return saved;
  });

  ipcMain.handle("notes:delete", async (_event, id) => {
    assertSafeId(id);
    try {
      await fs.unlink(join(notesDir(), `${id}.json`));
    } catch (error) {
      // A missing file is fine (already gone); surface anything else.
      if (error.code !== "ENOENT") {
        console.warn(`notes:delete failed for ${id}:`, error);
      }
    }
    return true;
  });

  ipcMain.handle("notes:revealFolder", async () => {
    await ensureDirs();
    const dir = notesDir();
    // shell.openPath resolves to a string: empty on success, error msg on failure.
    const failure = await shell.openPath(dir);
    if (failure) throw new Error(`Could not open ${dir}: ${failure}`);
    return dir;
  });
}
