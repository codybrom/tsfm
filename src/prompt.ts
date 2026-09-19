import { getFunctions, type NativePointer } from "./bindings.js";
import { PromptAttachmentError } from "./errors.js";

/** A file attached to a prompt. Requires a macOS 27 runtime and SDK. */
export interface PromptAttachment {
  /** Filesystem path to the image or document. */
  path: string;
  /** Optional label shown to the model alongside the attachment. */
  label?: string;
}

/** A prompt with attachments. Pass a plain string when you only need text. */
export interface PromptInput {
  text: string;
  attachments?: PromptAttachment[];
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
  const composed = fn.FMComposedPromptInitialize();
  try {
    fn.FMComposedPromptAddText(composed, typeof prompt === "string" ? prompt : prompt.text);
    if (typeof prompt !== "string") {
      for (const attachment of prompt.attachments ?? []) {
        const error = fn.FMComposedPromptAddAttachment(
          composed,
          attachment.path,
          attachment.label ?? null,
        );
        if (error !== 0) throw attachmentError(error, attachment.path);
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
      return new PromptAttachmentError(
        `Cannot attach ${path}: this native library was built without the macOS 27 SDK, ` +
          `so attachments are unavailable. Rebuild with an Xcode that includes it.`,
        "unsupported-sdk",
      );
    default:
      return new PromptAttachmentError(`Cannot attach ${path}.`, "unknown");
  }
}
