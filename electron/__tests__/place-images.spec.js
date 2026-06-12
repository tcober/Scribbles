// Tests the llm:place-images pipeline with vision and Ollama mocked: caption →
// placement → deterministic splice, plus every fallback (bad JSON, model
// failure, out-of-range blocks, empty notes) and cancel propagation.
import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

vi.mock("../ollama.js", () => {
  class FormatCancelled extends Error {
    constructor() {
      super("FORMAT_CANCELLED");
      this.name = "FormatCancelled";
    }
  }
  return {
    FormatCancelled,
    ollama: { list: vi.fn(), abort: vi.fn() },
    streamChat: vi.fn(),
  };
});

vi.mock("../ipc/image-describe.js", () => ({
  describeImage: vi.fn(async () => "a cat photo"),
}));

// The handler reads each attachment from disk before captioning, so give it a
// real (tiny) file rather than mocking node:fs.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const imageDir = mkdtempSync(join(tmpdir(), "scribbles-test-"));
const imagePath = join(imageDir, "a.png");
writeFileSync(imagePath, Buffer.from("fake-image-bytes"));
afterAll(() => rmSync(imageDir, { recursive: true, force: true }));

const { ipcMain } = await import("electron");
const { streamChat } = await import("../ollama.js");
const { describeImage } = await import("../ipc/image-describe.js");
const { cancelActiveRun } = await import("../ipc/active-run.js");
const { registerPlaceImagesHandlers } = await import("../ipc/place-images.js");

registerPlaceImagesHandlers();
const handlePlaceImages = new Map(ipcMain.handle.mock.calls).get(
  "llm:place-images",
);

const fakeEvent = () => ({ sender: { send: vi.fn() } });
const markdown = "# Title\n\nFirst para.\n\nSecond para.";
const image = {
  filename: "a.png",
  url: "note-image://n1/a.png",
  path: imagePath,
  mime: "image/png",
};

describe("llm:place-images", () => {
  it("returns the markdown untouched when no images are attached", async () => {
    const result = await handlePlaceImages(fakeEvent(), {
      markdown,
      images: [],
    });

    expect(result).toBe(markdown);
    expect(describeImage).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("splices each image after its chosen block with its vision caption", async () => {
    streamChat.mockResolvedValueOnce({
      content: 'Placement: [{"image":1,"after":2}]',
      tool_calls: [],
    });

    const result = await handlePlaceImages(fakeEvent(), {
      markdown,
      images: [image],
    });

    expect(result).toBe(
      "# Title\n\nFirst para.\n\n![a cat photo](note-image://n1/a.png)\n\nSecond para.",
    );
    // The placement prompt saw the numbered blocks and the caption.
    const userMessage = streamChat.mock.calls[0][0].messages.find(
      (message) => message.role === "user",
    ).content;
    expect(userMessage).toContain("[1] # Title");
    expect(userMessage).toContain("[1] a cat photo");
  });

  it("appends at the end when the model returns no parseable placement", async () => {
    streamChat.mockResolvedValueOnce({
      content: "I think it goes somewhere in the middle!",
      tool_calls: [],
    });

    const result = await handlePlaceImages(fakeEvent(), {
      markdown,
      images: [image],
    });

    expect(result).toBe(`${markdown}\n\n![a cat photo](note-image://n1/a.png)`);
  });

  it("appends when the chosen block does not exist", async () => {
    streamChat.mockResolvedValueOnce({
      content: '[{"image":1,"after":99}]',
      tool_calls: [],
    });

    const result = await handlePlaceImages(fakeEvent(), {
      markdown,
      images: [image],
    });

    expect(result).toBe(`${markdown}\n\n![a cat photo](note-image://n1/a.png)`);
  });

  it("appends when the placement model fails outright", async () => {
    streamChat.mockRejectedValueOnce(new Error("model crashed"));

    const result = await handlePlaceImages(fakeEvent(), {
      markdown,
      images: [image],
    });

    expect(result).toBe(`${markdown}\n\n![a cat photo](note-image://n1/a.png)`);
  });

  it("skips the placement call entirely for an empty note", async () => {
    describeImage.mockResolvedValueOnce(""); // vision failed → generic caption

    const result = await handlePlaceImages(fakeEvent(), {
      markdown: "",
      images: [image],
    });

    expect(streamChat).not.toHaveBeenCalled();
    expect(result).toBe("![image](note-image://n1/a.png)");
  });

  it("a cancel during captioning aborts the whole run", async () => {
    describeImage.mockImplementationOnce(async () => {
      cancelActiveRun(); // user hits Cancel while the vision pass runs
      return "a cat photo";
    });

    await expect(
      handlePlaceImages(fakeEvent(), { markdown, images: [image] }),
    ).rejects.toThrow("FORMAT_CANCELLED");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("captions images one at a time, reporting per-image progress", async () => {
    const secondImage = { ...image, filename: "b.png", url: "u2" };
    let finishFirst;
    describeImage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("second caption");
    streamChat.mockResolvedValueOnce({ content: "[]", tool_calls: [] });
    const event = fakeEvent();

    const pending = handlePlaceImages(event, {
      markdown,
      images: [image, secondImage],
    });

    // The second vision pass must wait for the first — concurrent passes are
    // what stack up Ollama's memory.
    await vi.waitFor(() => expect(describeImage).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(describeImage).toHaveBeenCalledTimes(1);

    finishFirst("first caption");
    const result = await pending;

    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(result).toContain("![first caption]");
    expect(result).toContain("![second caption]");
    const details = event.sender.send.mock.calls.map(
      ([, payload]) => payload.detail,
    );
    expect(details).toContain("image 1 of 2");
    expect(details).toContain("image 2 of 2");
  });
});
