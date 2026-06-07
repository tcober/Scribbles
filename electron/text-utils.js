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
