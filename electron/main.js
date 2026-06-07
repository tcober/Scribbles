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

// Wire up every ipcMain.handle(...) before the app is ready — registration is
// synchronous and order-independent, so the renderer can invoke as soon as it loads.
registerNoteHandlers();
registerImageHandlers();
registerTranscribeHandler();
registerFormatHandlers();
registerPlaceImagesHandlers();

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

  registerImageProtocol();

  // Grant microphone access automatically — this is the only sensitive permission we use.
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
