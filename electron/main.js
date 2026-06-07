// Main-process entry point: registers the IPC handlers and image protocol, then
// creates the window and wires up app/mic lifecycle once Electron is ready.
import {
  app,
  BrowserWindow,
  session,
  systemPreferences,
  protocol,
  nativeImage,
} from "electron";

import { APP_ICON } from "./config.js";
import { ensureDirs } from "./paths.js";
import { createWindow } from "./window.js";
import { registerNoteHandlers } from "./ipc/notes.js";
import { registerImageHandlers, registerImageProtocol } from "./ipc/images.js";
import { registerTranscribeHandler } from "./ipc/transcribe.js";
import { registerFormatHandlers } from "./ipc/format.js";
import { registerPlaceImagesHandlers } from "./ipc/place-images.js";

// Register all IPC handlers before app-ready (synchronous, order-independent).
registerNoteHandlers();
registerImageHandlers();
registerTranscribeHandler();
registerFormatHandlers();
registerPlaceImagesHandlers();

// Privilege the note-image:// scheme before app-ready so the markdown preview's
// <img> tags can resolve it (the handler itself is registered after ready).
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

  // Set the macOS dock icon for dev runs (packaged builds use the .icns).
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(APP_ICON);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  registerImageProtocol();

  // Auto-grant microphone — the only sensitive permission the app uses.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media" || permission === "microphone");
    },
  );

  if (process.platform === "darwin") {
    try {
      await systemPreferences.askForMediaAccess("microphone");
    } catch (err) {
      console.warn("Microphone access request failed:", err);
    }
  }

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
