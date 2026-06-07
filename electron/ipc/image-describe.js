import { FormatCancelled, streamChat } from "../ollama.js";
import { IMAGE_DESCRIBE_SYSTEM_PROMPT } from "../prompts.js";

// Run a single-image vision pass so each attachment gets its own concise caption.
// Done per image (rather than batching) because the local vision model can't
// reliably tell several batched images apart — analyzing them one at a time is
// what lets the placement pass put each one in the right spot. Best-effort: on
// any failure we return '' and the caller falls back to a generic caption.
export async function describeImage(base64, token) {
  try {
    const message = await streamChat({
      messages: [
        { role: "system", content: IMAGE_DESCRIBE_SYSTEM_PROMPT },
        { role: "user", content: "Describe this image.", images: [base64] },
      ],
      options: { temperature: 0.1 },
      token,
    });
    return message.content.replace(/\s+/g, " ").trim();
  } catch (err) {
    // Let a deliberate cancel bubble up; swallow only real description failures.
    if (err instanceof FormatCancelled) throw err;
    return "";
  }
}
