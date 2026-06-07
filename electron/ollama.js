import { Ollama } from "ollama";

import { OLLAMA_HOST, OLLAMA_MODEL, OLLAMA_KEEP_ALIVE } from "./config.js";

export const ollama = new Ollama({ host: OLLAMA_HOST });

// Thrown when the user cancels an in-progress format. Carries a recognizable
// message so the renderer can distinguish a deliberate cancel from a real error.
export class FormatCancelled extends Error {
  constructor() {
    super("FORMAT_CANCELLED");
    this.name = "FormatCancelled";
  }
}

// Run one streaming chat turn against Ollama, accumulating the text (and any
// tool calls) as it arrives. Streaming is what makes the request abortable
// mid-generation: `ollama.abort()` only cancels ongoing *streamed* requests, and
// it lets us report live progress to the renderer via onProgress.
export async function streamChat({ messages, tools, options, token, onProgress }) {
  const iterator = await ollama.chat({
    model: OLLAMA_MODEL,
    messages,
    ...(tools ? { tools } : {}),
    options,
    keep_alive: OLLAMA_KEEP_ALIVE,
    stream: true,
  });

  let content = "";
  const toolCalls = [];
  try {
    for await (const chunk of iterator) {
      if (token?.cancelled) {
        iterator.abort();
        throw new FormatCancelled();
      }
      const part = chunk.message || {};
      if (part.content) {
        content += part.content;
        onProgress?.(content);
      }
      if (Array.isArray(part.tool_calls) && part.tool_calls.length) {
        toolCalls.push(...part.tool_calls);
      }
    }
  } catch (err) {
    // An external abort (cancel IPC calling ollama.abort()) surfaces here as an
    // AbortError; treat it — and our own sentinel — as a cancellation.
    if (err instanceof FormatCancelled) throw err;
    if (token?.cancelled || err?.name === "AbortError")
      throw new FormatCancelled();
    throw err;
  }

  return { role: "assistant", content: content.trim(), tool_calls: toolCalls };
}
