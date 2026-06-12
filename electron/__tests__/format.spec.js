// Tests the llm:format pipeline end to end with the Ollama stream and web
// search mocked: prompt assembly, the slice-by-slice merge loop, the tool-call
// turns, progress throttling, cancellation, and the llm:check probe.
import { describe, it, expect, vi } from "vitest";

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

vi.mock("../web-search.js", () => ({
  WEB_SEARCH_TOOL: { type: "function", function: { name: "web_search" } },
  executeToolCall: vi.fn(async () => "tool result"),
  formatPreSearchBlock: vi.fn(() => "WEB-RESULTS-BLOCK"),
  preSearchFromContext: vi.fn(async () => []),
}));

const { ipcMain } = await import("electron");
const { ollama, streamChat } = await import("../ollama.js");
const { executeToolCall, preSearchFromContext } =
  await import("../web-search.js");
const { registerFormatHandlers } = await import("../ipc/format.js");

registerFormatHandlers();
const handlers = new Map(ipcMain.handle.mock.calls);
const handleFormat = handlers.get("llm:format");
const handleCheck = handlers.get("llm:check");
const handleCancel = handlers.get("llm:cancel-format");

const fakeEvent = () => ({ sender: { send: vi.fn() } });

// The user-role message body sent on the given streamChat call.
function sentUserMessage(callIndex) {
  const { messages } = streamChat.mock.calls[callIndex][0];
  return messages.find((message) => message.role === "user").content;
}

describe("llm:format", () => {
  it("returns the existing notes untouched when there is no transcript", async () => {
    const result = await handleFormat(fakeEvent(), {
      transcript: "   ",
      existing: "# Old notes",
      context: "",
    });

    expect(result).toBe("# Old notes");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("formats a short transcript in one pass and strips chat fluff", async () => {
    streamChat.mockResolvedValueOnce({
      content: "Sure! Here are your formatted notes:\n\n# Done",
      tool_calls: [],
    });

    const result = await handleFormat(fakeEvent(), {
      transcript: "Hello world.",
      existing: "",
      context: "",
    });

    expect(result).toBe("# Done");
    expect(streamChat).toHaveBeenCalledTimes(1);
    // No web tools without context, and no "Existing notes" section when empty.
    expect(streamChat.mock.calls[0][0]).not.toHaveProperty("tools");
    expect(sentUserMessage(0)).toContain("Transcript:\n\nHello world.");
    expect(sentUserMessage(0)).not.toContain("Existing notes:");
  });

  it("asks the model to merge into existing notes when there are any", async () => {
    streamChat.mockResolvedValueOnce({ content: "# Merged", tool_calls: [] });

    await handleFormat(fakeEvent(), {
      transcript: "New speech.",
      existing: "# Old notes",
      context: "",
    });

    expect(sentUserMessage(0)).toContain("Existing notes:\n\n# Old notes");
    expect(sentUserMessage(0)).toContain(
      "New transcript to merge:\n\nNew speech.",
    );
  });

  // Long enough for two slices at the 6000-char default (~7000 chars).
  const twoSliceTranscript = Array.from(
    { length: 150 },
    (_unused, index) => `Sentence number ${index} is here to pad things out.`,
  ).join(" ");

  it("slices a long transcript and feeds each pass the previous pass's output", async () => {
    const transcript = twoSliceTranscript;
    streamChat
      .mockResolvedValueOnce({ content: "PASS-ONE", tool_calls: [] })
      .mockResolvedValueOnce({ content: "PASS-TWO", tool_calls: [] });
    const event = fakeEvent();

    const result = await handleFormat(event, {
      transcript,
      existing: "",
      context: "",
    });

    expect(result).toBe("PASS-TWO");
    expect(streamChat).toHaveBeenCalledTimes(2);
    // The second slice merges into the notes the first slice produced.
    expect(sentUserMessage(1)).toContain("Existing notes:\n\nPASS-ONE");
    // Progress names the parts so a long format reads as advancing.
    const stages = event.sender.send.mock.calls.map(
      ([, payload]) => payload.stage,
    );
    expect(stages).toContain("Formatting part 1 of 2…");
    expect(stages).toContain("Formatting part 2 of 2…");
  });

  it("runs requested web tools, then synthesizes from their results", async () => {
    const toolCall = {
      function: { name: "web_search", arguments: { query: "react 19" } },
    };
    streamChat
      .mockResolvedValueOnce({ content: "", tool_calls: [toolCall] })
      .mockResolvedValueOnce({ content: "# With sources", tool_calls: [] });

    const result = await handleFormat(fakeEvent(), {
      transcript: "Talk about React.",
      existing: "",
      context: "Mention the new React features",
    });

    expect(result).toBe("# With sources");
    expect(sentUserMessage(0)).toContain("Background context");
    // First turn offered the tool; its call was executed and fed back.
    expect(streamChat.mock.calls[0][0].tools).toBeDefined();
    expect(executeToolCall).toHaveBeenCalledWith("web_search", {
      query: "react 19",
    });
    const secondTurnMessages = streamChat.mock.calls[1][0].messages;
    expect(secondTurnMessages).toContainEqual({
      role: "tool",
      name: "web_search",
      content: "tool result",
    });
  });

  it("injects pre-search results into the prompt when the context asked for lookups", async () => {
    preSearchFromContext.mockResolvedValueOnce([
      { query: "react 19", hits: [] },
    ]);
    streamChat.mockResolvedValueOnce({ content: "# Done", tool_calls: [] });

    await handleFormat(fakeEvent(), {
      transcript: "Speech.",
      existing: "",
      context: "look up react 19",
    });

    expect(sentUserMessage(0)).toContain("WEB-RESULTS-BLOCK");
  });

  it("sets settled notes aside instead of asking later passes to rewrite them", async () => {
    // Pass 1 produces notes well past the per-pass bound: a long settled run,
    // then a fresh section a later pass might still need to merge into.
    const settled = "S".repeat(2100);
    const passOne = `${settled}\n# Fresh section\n\njust merged`;
    streamChat
      .mockResolvedValueOnce({ content: passOne, tool_calls: [] })
      .mockResolvedValueOnce({
        content: "# Fresh section\n\nmerged twice",
        tool_calls: [],
      });

    const result = await handleFormat(fakeEvent(), {
      transcript: twoSliceTranscript,
      existing: "",
      context: "",
    });

    // Pass 2 re-read only the recent tail, not the 2100-char settled run...
    expect(sentUserMessage(1)).toContain("Existing notes:\n\n# Fresh section");
    expect(sentUserMessage(1)).not.toContain("S".repeat(100));
    // ...and the settled run returns verbatim in the final document.
    expect(result).toBe(`${settled}\n\n# Fresh section\n\nmerged twice`);
  });

  it("a cancel between passes stops the run with FORMAT_CANCELLED", async () => {
    const transcript = twoSliceTranscript;
    streamChat.mockImplementationOnce(async () => {
      handleCancel(); // user hits Cancel while pass 1 is generating
      return { content: "PASS-ONE", tool_calls: [] };
    });

    await expect(
      handleFormat(fakeEvent(), { transcript, existing: "", context: "" }),
    ).rejects.toThrow("FORMAT_CANCELLED");
    expect(streamChat).toHaveBeenCalledTimes(1); // pass 2 never started
    expect(ollama.abort).toHaveBeenCalled();
  });

  it("throttles live progress and reports only meaningful growth", async () => {
    const event = fakeEvent();
    streamChat.mockImplementationOnce(async ({ onProgress }) => {
      onProgress("tiny"); // below the 24-char threshold — dropped
      onProgress("X".repeat(40));
      return { content: "ok", tool_calls: [] };
    });

    await handleFormat(event, {
      transcript: "Speech.",
      existing: "",
      context: "",
    });

    const details = event.sender.send.mock.calls
      .map(([, payload]) => payload.detail)
      .filter(Boolean);
    expect(details).toEqual(["X".repeat(40)]);
  });
});

describe("llm:check", () => {
  it("reports ok with and without the model installed", async () => {
    ollama.list.mockResolvedValueOnce({
      models: [{ name: "gemma4:latest" }],
    });
    await expect(handleCheck()).resolves.toMatchObject({
      ok: true,
      hasModel: true,
    });

    ollama.list.mockResolvedValueOnce({ models: [{ name: "llama3:8b" }] });
    await expect(handleCheck()).resolves.toMatchObject({
      ok: true,
      hasModel: false,
    });
  });

  it("reports an unreachable Ollama as ok:false with the error", async () => {
    ollama.list.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(handleCheck()).resolves.toMatchObject({
      ok: false,
      error: "ECONNREFUSED",
    });
  });
});
