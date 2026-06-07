// Cap how much of the already-formatted note we re-send to Gemma each format.
// Sending the whole note every time grows the prompt (and Gemma's KV-cache
// memory) without bound as it gets longer — the main thing that pushes a low-RAM
// Mac into swap mid-format. We keep everything before a clean markdown boundary
// verbatim ("head") and only hand Gemma the recent tail as context, so it can
// still merge new speech into the latest section seamlessly.
export const MAX_FORMAT_CONTEXT_CHARS = 2000;

export function splitFormatContext(formatted) {
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
