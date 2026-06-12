// Tests streamChat's dynamic behavior: accumulating a streamed reply, live
// progress, tool-call collection, and the three cancellation routes (token
// checked mid-stream, external AbortError, real errors passed through).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("ollama", () => ({
  Ollama: class {
    constructor() {
      this.chat = vi.fn();
      this.abort = vi.fn();
    }
  },
}));

const { ollama, streamChat, FormatCancelled } = await import("../ollama.js");
const { OLLAMA_NUM_CTX } = await import("../config.js");

// An abortable async iterable that yields the given chunks, like ollama's
// streaming response.
function fakeStream(chunks) {
  return {
    abort: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

describe("streamChat", () => {
  beforeEach(() => {
    ollama.chat.mockReset();
  });

  it("accumulates streamed content and returns a trimmed assistant message", async () => {
    ollama.chat.mockResolvedValue(
      fakeStream([
        { message: { content: " Hello" } },
        { message: { content: " world " } },
        { message: {} }, // final empty delta
      ]),
    );

    const message = await streamChat({ messages: [] });

    expect(message).toEqual({
      role: "assistant",
      content: "Hello world",
      tool_calls: [],
    });
  });

  it("reports the growing text to onProgress as chunks arrive", async () => {
    ollama.chat.mockResolvedValue(
      fakeStream([
        { message: { content: "one" } },
        { message: { content: " two" } },
      ]),
    );
    const onProgress = vi.fn();

    await streamChat({ messages: [], onProgress });

    expect(onProgress.mock.calls.map(([text]) => text)).toEqual([
      "one",
      "one two",
    ]);
  });

  it("collects tool calls across chunks alongside any content", async () => {
    const firstCall = { function: { name: "web_search", arguments: {} } };
    const secondCall = { function: { name: "web_search", arguments: {} } };
    ollama.chat.mockResolvedValue(
      fakeStream([
        { message: { tool_calls: [firstCall] } },
        { message: { content: "thinking…", tool_calls: [secondCall] } },
      ]),
    );

    const message = await streamChat({ messages: [] });

    expect(message.tool_calls).toEqual([firstCall, secondCall]);
    expect(message.content).toBe("thinking…");
  });

  it("pins the shared context window while preserving caller options", async () => {
    ollama.chat.mockResolvedValue(fakeStream([]));

    await streamChat({ messages: [], options: { temperature: 0.1 } });

    // Identical num_ctx on every call is what stops Ollama from reloading the
    // model between passes; the caller's sampling options ride along.
    expect(ollama.chat.mock.calls[0][0].options).toEqual({
      num_ctx: OLLAMA_NUM_CTX,
      temperature: 0.1,
    });
  });

  it("only sends the tools field when tools are provided", async () => {
    ollama.chat.mockResolvedValue(fakeStream([]));

    await streamChat({ messages: [] });
    expect(ollama.chat.mock.calls[0][0]).not.toHaveProperty("tools");

    await streamChat({ messages: [], tools: [{ type: "function" }] });
    expect(ollama.chat.mock.calls[1][0].tools).toEqual([{ type: "function" }]);
  });

  it("aborts the stream and throws FormatCancelled when the token flips mid-stream", async () => {
    const token = { cancelled: false };
    const stream = {
      abort: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield { message: { content: "before cancel" } };
        token.cancelled = true; // user hits Cancel between chunks
        yield { message: { content: "after cancel" } };
      },
    };
    ollama.chat.mockResolvedValue(stream);

    await expect(streamChat({ messages: [], token })).rejects.toBeInstanceOf(
      FormatCancelled,
    );
    expect(stream.abort).toHaveBeenCalledTimes(1);
  });

  it("translates an external AbortError into FormatCancelled", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    ollama.chat.mockResolvedValue({
      abort: vi.fn(),
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw abortError;
      },
    });

    await expect(streamChat({ messages: [] })).rejects.toBeInstanceOf(
      FormatCancelled,
    );
  });

  it("passes real stream errors through untouched", async () => {
    ollama.chat.mockResolvedValue({
      abort: vi.fn(),
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("connection refused");
      },
    });

    await expect(streamChat({ messages: [] })).rejects.toThrow(
      "connection refused",
    );
  });
});
