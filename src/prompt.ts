import { statSync } from "node:fs";
import { getFunctions, type NativePointer } from "./bindings.js";
import { PromptAttachmentError } from "./errors.js";

/** An image attached to a prompt. Requires macOS 27. */
export interface PromptAttachment {
  /**
   * Filesystem path to the image. The bridge only builds image attachments,
   * and the file must exist when the request is made.
   */
  path: string;
  /** Optional label shown to the model alongside the attachment. */
  label?: string;
}

/** Prompt text followed by its attachments. */
export interface TextPromptInput {
  text: string;
  attachments?: PromptAttachment[];
}

/**
 * Prompt parts in the order the model sees them: text and attachments can
 * interleave, and a prompt can be an image alone.
 */
export interface ContentPromptInput {
  content: Array<string | PromptAttachment>;
}

/**
 * A prompt with attachments. Pass a plain string when you only need text;
 * `{ text, attachments }` to put attachments after the text; or `{ content }`
 * to order text and attachments yourself.
 */
export type PromptInput = TextPromptInput | ContentPromptInput;

/** The prompt's parts in order. A `{ text }` prompt always has its text, even empty. */
function promptParts(prompt: string | PromptInput): Array<string | PromptAttachment> {
  if (typeof prompt === "string") return [prompt];
  if ("content" in prompt) return prompt.content;
  return [prompt.text, ...(prompt.attachments ?? [])];
}

/**
 * Throws `PromptAttachmentError` (`"not-found"`) unless the path is a file.
 * The bridge hands the path to the framework without looking, and the request
 * would fail later with an error that doesn't name the file.
 */
function assertAttachmentExists(attachment: PromptAttachment): void {
  let isFile = false;
  try {
    isFile = statSync(attachment.path).isFile();
  } catch {
    // Missing, or a path we can't read: reported below.
  }
  if (!isFile) {
    throw new PromptAttachmentError(
      `Cannot attach ${attachment.path}: the file doesn't exist.`,
      "not-found",
    );
  }
}

/**
 * Build a native ComposedPrompt from prompt text.
 *
 * Upstream's C bridge takes an opaque prompt object rather than a string, so
 * every request builds one. `FMComposedPromptInitialize` hands back a +1
 * reference the caller owns: release it once the request that uses it has
 * finished, not when the call returns, since the native side reads it for the
 * duration of the response.
 */
export function composePrompt(
  fn: ReturnType<typeof getFunctions>,
  prompt: string | PromptInput,
): NativePointer {
  const parts = promptParts(prompt);
  // Checked before any native call, so a bad path costs nothing native.
  for (const part of parts) {
    if (typeof part !== "string") assertAttachmentExists(part);
  }
  const composed = fn.FMComposedPromptInitialize();
  try {
    for (const part of parts) {
      if (typeof part === "string") {
        fn.FMComposedPromptAddText(composed, part);
      } else {
        const error = fn.FMComposedPromptAddAttachment(composed, part.path, part.label ?? null);
        if (error !== 0) throw attachmentError(error, part.path);
      }
    }
  } catch (err) {
    // We own the +1 from Initialize, and no request will take it from here.
    fn.FMRelease(composed);
    throw err;
  }
  return composed;
}

/** Map FMComposedPromptAddImageError to a typed error. */
export function attachmentError(code: number, path: string): PromptAttachmentError {
  switch (code) {
    case 1:
      return new PromptAttachmentError(
        `Cannot attach ${path}: attachments require a macOS 27 runtime.`,
        "unsupported-os",
      );
    case 2:
      // Unreachable with tsfm's bridge, which always builds against the macOS
      // 27 SDK; kept for a library built from upstream's bridge.
      return new PromptAttachmentError(
        `Cannot attach ${path}: this native library was built without the macOS 27 SDK, ` +
          `so attachments are unavailable. Rebuild with an Xcode that includes it.`,
        "unsupported-sdk",
      );
    default:
      return new PromptAttachmentError(`Cannot attach ${path}.`, "unknown");
  }
}
