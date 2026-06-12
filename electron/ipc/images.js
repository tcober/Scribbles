// Image storage: add/delete handlers that persist attachments under
// userData/images/<noteId>/, plus the note-image:// protocol that serves them.
import { ipcMain, protocol, net } from "electron";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";

import { EXT_BY_MIME } from "../config.js";
import { imagesDirFor } from "../paths.js";

export function registerImageHandlers() {
  // Save a binary image (dataUrl or raw buffer) to userData/images/<noteId>/.
  ipcMain.handle("images:add", async (_event, { noteId, dataUrl }) => {
    if (!noteId || !dataUrl) throw new Error("noteId and dataUrl required");

    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Expected a data: URL");
    const mime = match[1].toLowerCase();
    const extension = EXT_BY_MIME[mime];
    if (!extension) throw new Error(`Unsupported image type: ${mime}`);

    const buffer = Buffer.from(match[2], "base64");
    const id = crypto.randomUUID();
    const filename = `${id}${extension}`;

    const dir = imagesDirFor(noteId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, filename), buffer);

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
}

// Serve note-image://<noteId>/<filename> from userData/images/<noteId>/<filename>.
// Must be called after the app is ready (protocol.handle requirement).
export function registerImageProtocol() {
  protocol.handle("note-image", async (request) => {
    try {
      const url = new URL(request.url);
      const noteId = url.hostname;
      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!noteId || !filename || filename.includes("..")) {
        return new Response("Bad request", { status: 400 });
      }
      const filePath = join(imagesDirFor(noteId), filename);
      return net.fetch(`file://${filePath}`);
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  });
}
