const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Ad-hoc code-sign the packaged app.
//
// We distribute unsigned (no Apple Developer ID), but Apple Silicon refuses to
// launch a bundle whose code signature is missing or stale — and electron-builder
// leaves the outer bundle's seal invalid once our extraResources (the bundled
// whisper-cli binary) are added. Applying a self-consistent ad-hoc signature
// (no hardened runtime, no entitlements) makes the app launchable once the user
// clears the download quarantine. It is NOT notarized, so first launch still
// needs the one-time manual Gatekeeper approval documented in the README.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  console.log(`  • ad-hoc signed ${appName}.app`);
};
