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
}

// Serve note-image://<noteId>/<filename> from userData/images/<noteId>/<filename>.
// Must be called after the app is ready (protocol.handle requirement).
export function registerImageProtocol() {
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
}
