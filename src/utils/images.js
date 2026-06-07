// True when a MIME type names an image (e.g. "image/png"). Used to filter
// dropped/pasted payloads down to the images we can actually attach.
export function isImageType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

// True when a File/clipboard item is an image, tolerating a missing entry.
export function isImageFile(file) {
  return Boolean(file) && isImageType(file.type);
}
