// Split a long transcript into ordered slices of roughly `targetChars`, breaking
// on paragraph then sentence boundaries so each slice is self-contained. Used to
// feed Gemma the transcript incrementally (merging each slice into the running
// notes) instead of in one giant prompt. A run-on with no punctuation is hard-cut
// as a last resort so a single slice never exceeds the target by much.
export function chunkText(text, targetChars) {
  const trimmed = text.trim();
  if (trimmed.length <= targetChars) return [trimmed];

  // Break into the smallest natural units we can (sentences within paragraphs).
  const units = [];
  for (const paragraph of trimmed.split(/\n{2,}/)) {
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      const piece = sentence.trim();
      if (!piece) continue;
      if (piece.length <= targetChars) {
        units.push(piece);
      } else {
        for (let index = 0; index < piece.length; index += targetChars) {
          units.push(piece.slice(index, index + targetChars).trim());
        }
      }
    }
  }

  // Greedily pack units back up to ~targetChars so we don't over-fragment.
  const chunks = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 1 > targetChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [trimmed];
}

// Split Markdown into its top-level blocks (maximal runs of non-blank lines,
// separated by blank lines), recording each block's end offset in the original
// string. The offset points just past the block's last character — before the
// blank-line separator — which is exactly where a new image block should be
// spliced so the surrounding text is left byte-for-byte unchanged.
export function splitBlocksWithOffsets(markdown) {
  const blocks = [];
  if (!markdown) return blocks;
  // A block starts at a non-newline char and runs until the next blank line
  // (\n[ \t]*\n) or the end of the string. [^\n] guarantees forward progress.
  const regex = /[^\n][\s\S]*?(?=\n[ \t]*\n|\s*$)/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const text = match[0];
    // Whitespace-only runs (e.g. trailing spaces) aren't real blocks.
    if (text.trim()) {
      blocks.push({ text, endIndex: match.index + text.length });
    }
  }
  return blocks;
}

// Splice image lines into `markdown` without altering any of its original bytes.
// `items` is an array of { caption, url, after } where `after` is the 1-based
// index (into `blocks`) of the block the image should follow; an out-of-range,
// missing, or non-integer `after` appends the image at the end. Multiple images
// targeting the same block keep their input order.
export function insertImagesAtBlocks(markdown, blocks, items) {
  const base = markdown || "";
  const inserts = [];
  const appended = [];
  for (const item of items || []) {
    const line = imageLine(item.caption, item.url);
    const after = item.after;
    if (Number.isInteger(after) && after >= 1 && after <= blocks.length) {
      inserts.push({ offset: blocks[after - 1].endIndex, text: line });
    } else {
      appended.push(line);
    }
  }

  // Array.sort is stable, so equal offsets preserve input order.
  inserts.sort((left, right) => left.offset - right.offset);

  let result = "";
  let cursor = 0;
  for (const insertion of inserts) {
    result += `${base.slice(cursor, insertion.offset)}\n\n${insertion.text}`;
    cursor = insertion.offset;
  }
  result += base.slice(cursor);

  if (appended.length) {
    const body = result.replace(/\s+$/, "");
    const tail = appended.join("\n\n");
    result = body ? `${body}\n\n${tail}` : tail;
  }
  return result;
}

// Build a Markdown image line. Captions are flattened to a single line and
// stripped of brackets so they can't break the ![...](...) syntax.
function imageLine(caption, url) {
  const safe =
    (caption || "").replace(/\s+/g, " ").replace(/[[\]]/g, "").trim() ||
    "image";
  return `![${safe}](${url})`;
}

// Strip conversational fluff Gemma sometimes prepends/appends despite being told
// not to: "Here are your notes…", "If you'd like more detail…", "Hope this helps!",
// outer ``` fences wrapping the whole document, etc.
export function stripConversational(text) {
  let result = text.trim();

  // Drop an outer triple-backtick fence wrapping the entire response.
  const fence = result.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) result = fence[1].trim();

  const leadPatterns = [
    /^(?:sure|of course|certainly|absolutely|got it|okay|ok|alright|great)[!.,:]*\s*/i,
    /^(?:here(?:'s| is| are)[^\n]*?(?:notes?|markdown|formatted)[^\n]*?[:.\n])\s*/i,
    /^(?:based on (?:the|your)[^\n]*?(?:transcript|notes?|context)[^\n]*?[:.\n])\s*/i,
    /^(?:i(?:'ve| have)[^\n]*?(?:formatted|organized|cleaned up|merged|updated)[^\n]*?[:.\n])\s*/i,
    /^(?:below (?:is|are)[^\n]*?[:.\n])\s*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadPatterns) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next.trimStart();
        changed = true;
      }
    }
  }

  const tailPatterns = [
    /\n+(?:i hope (?:this|that) helps[^\n]*)$/i,
    /\n+(?:hope (?:this|that) helps[^\n]*)$/i,
    /\n+(?:let me know if[^\n]*)$/i,
    /\n+(?:if you(?:'d| would)? like[^\n]*(?:more|further|additional)[^\n]*)$/i,
    /\n+(?:if you (?:can )?(?:tell|give|share|provide)[^\n]*(?:more|additional)[^\n]*)$/i,
    /\n+(?:feel free to[^\n]*)$/i,
    /\n+(?:would you like[^\n]*)$/i,
  ];
  changed = true;
  while (changed) {
    changed = false;
    for (const pattern of tailPatterns) {
      const next = result.replace(pattern, "");
      if (next !== result) {
        result = next.trimEnd();
        changed = true;
      }
    }
  }

  return result.trim();
}
