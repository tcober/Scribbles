import { ipcMain } from "electron";
import { promises as fs } from "node:fs";

import { FormatCancelled, streamChat } from "../ollama.js";
import { PLACE_IMAGES_SYSTEM_PROMPT } from "../prompts.js";
import { insertImagesAtBlocks, splitBlocksWithOffsets } from "../text-utils.js";
import { beginReportedRun, endRun } from "./active-run.js";
import { describeImage } from "./image-describe.js";

// Cap on how much of each block we show the placement model — enough to identify
// the section, short enough to keep the prompt bounded for long notes.
const BLOCK_PREVIEW_CHARS = 400;

export function registerPlaceImagesHandlers() {
  ipcMain.handle("llm:place-images", handlePlaceImages);
}

// Place attached images into existing notes without changing any of the prose.
// Each image gets a vision-generated caption; Gemma then only chooses which block
// each image should follow, and we splice the image lines in deterministically so
// the original text stays byte-for-byte identical. Returns the updated Markdown.
async function handlePlaceImages(event, { markdown, images }) {
  const base = typeof markdown === "string" ? markdown : "";
  if (!Array.isArray(images) || images.length === 0) return base;

  const { token, report, ensureLive } = beginReportedRun(event);

  try {
    // Caption each image on its own (the local vision model can't reliably tell
    // batched images apart). The caption doubles as the placement hint.
    report("Looking at images…", `${images.length} attached`);
    const captions = await Promise.all(
      images.map(async (image) => {
        const base64 = (await fs.readFile(image.path)).toString("base64");
        return describeImage(base64, token);
      }),
    );
    ensureLive();

    const blocks = splitBlocksWithOffsets(base);

    // Ask Gemma which block each image should follow. With no blocks to place
    // into (empty note), skip the call and append everything.
    let placements = {};
    if (blocks.length) {
      report("Finding the best spot…");
      placements = await choosePlacements({ blocks, captions, token, report });
    }
    ensureLive();

    const items = images.map((image, index) => ({
      caption: captions[index],
      url: image.url,
      after: placements[index + 1],
    }));

    return insertImagesAtBlocks(base, blocks, items);
  } finally {
    endRun(token);
  }
}

// Run the placement pass and parse its JSON into a { imageNumber: blockNumber }
// map. Best-effort: a cancel propagates, but a model/parse failure falls back to
// an empty map so every image is simply appended at the end.
async function choosePlacements({ blocks, captions, token, report }) {
  const blockList = blocks
    .map((block, index) => `[${index + 1}] ${preview(block.text)}`)
    .join("\n\n");
  const imageList = captions
    .map((caption, index) => `[${index + 1}] ${caption || "image"}`)
    .join("\n");

  const userMessage = [
    `Notes (numbered blocks):\n\n${blockList}`,
    "---",
    `Images:\n\n${imageList}`,
    "---",
    "Return the placement JSON described above and nothing else.",
  ].join("\n\n");

  try {
    const message = await streamChat({
      messages: [
        { role: "system", content: PLACE_IMAGES_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      options: { temperature: 0.1 },
      token,
      onProgress: () => report("Finding the best spot…"),
    });
    return parsePlacements(message.content, blocks.length);
  } catch (err) {
    if (err instanceof FormatCancelled) throw err;
    return {};
  }
}

// Pull the first JSON array out of the model's reply and turn it into a
// { imageNumber: blockNumber } map, dropping anything malformed or out of range.
function parsePlacements(text, blockCount) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return {};
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  if (!Array.isArray(parsed)) return {};

  const placements = {};
  for (const entry of parsed) {
    const image = Number(entry?.image);
    const after = Number(entry?.after);
    if (!Number.isInteger(image)) continue;
    // Keep only blocks that actually exist; anything else becomes an append (0).
    placements[image] =
      Number.isInteger(after) && after >= 1 && after <= blockCount ? after : 0;
  }
  return placements;
}

function preview(text) {
  const flat = text.trim();
  return flat.length > BLOCK_PREVIEW_CHARS
    ? `${flat.slice(0, BLOCK_PREVIEW_CHARS)}…`
    : flat;
}
