import { statSync } from "node:fs";
import { getFunctions, type NativePointer } from "./bindings.js";
import { PromptAttachmentError, type PromptAttachmentFailure } from "./errors.js";

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
 * A prompt with attachments. Pass a plain string when you only need text,
 * `{ text, attachments }` to put attachments after the text, or `{ content }`
 * to order text and attachments yourself.
 */
export type PromptInput = TextPromptInput | ContentPromptInput;

const SHAPES = "a string, { text, attachments? } or { content: [...] }";

/**
 * The prompt's parts in order. A `{ text }` prompt always has its text, even
 * empty. Shapes are checked here rather than trusted from the types, because
 * JavaScript callers reach this too, and a missing `text` would otherwise
 * surface as a null dereference further down.
 */
function promptParts(prompt: string | PromptInput): Array<string | PromptAttachment> {
  if (typeof prompt === "string") return [prompt];
  if (prompt === null || typeof prompt !== "object") {
    throw new TypeError(
      `A prompt must be ${SHAPES}, got ${prompt === null ? "null" : typeof prompt}`,
    );
  }
  // Read through a plain record: hasOwn, not `in`, so a polluted
  // Object.prototype.content can't make a { text } prompt read as a content
  // array, and every value is checked before it's trusted.
  const own = prompt as unknown as Record<string, unknown>;
  let parts: unknown[];
  if (Object.hasOwn(own, "content")) {
    if (!Array.isArray(own.content)) {
      throw new TypeError(`A prompt's "content" must be an array of text and attachments`);
    }
    parts = own.content;
  } else {
    if (!Object.hasOwn(own, "text") || typeof own.text !== "string") {
      throw new TypeError(`A prompt must be ${SHAPES}. This one has no "text"`);
    }
    // An explicit undefined or null reads as "no attachments", like the
    // optional property it is. Only read attachments if it's an own property,
    // so a polluted Object.prototype cannot inject files.
    const attachments = Object.hasOwn(own, "attachments") ? (own.attachments ?? []) : [];
    if (!Array.isArray(attachments)) {
      throw new TypeError(`A prompt's "attachments" must be an array`);
    }
    parts = [own.text, ...attachments];
  }
  // Returns fresh attachments built from own properties only: a polluted
  // Object.prototype must not be able to attach a file the caller never named,
  // and re-reading the caller's object later would find it again.
  return parts.map((part) => {
    if (typeof part === "string") return part;
    if (
      part === null ||
      typeof part !== "object" ||
      !Object.hasOwn(part, "path") ||
      typeof (part as Record<string, unknown>).path !== "string"
    ) {
      throw new TypeError(`Every prompt part must be text or an attachment with a "path"`);
    }
    const record = part as Record<string, unknown>;
    const label = Object.hasOwn(record, "label") ? record.label : undefined;
    if (label != null && typeof label !== "string") {
      throw new TypeError(`An attachment's "label" must be a string, got ${typeof label}`);
    }
    // label is always an own property, even when absent: a literal without it
    // would read a polluted Object.prototype.label at use.
    return { path: record.path as string, label: label as string | undefined };
  });
}

/**
 * Throws `PromptAttachmentError` (`"not-found"`) unless the path is a file.
 * The bridge hands the path to the framework without looking, and the request
 * would fail later with an error that doesn't name the file.
 */
function assertAttachmentExists(attachment: PromptAttachment): void {
  let problem: string | null = null;
  // "not-found" only when the path really isn't there: a directory or an
  // unreadable file is a different thing for a caller to handle.
  let reason: PromptAttachmentFailure = "not-found";
  try {
    if (!statSync(attachment.path).isFile()) {
      problem = "it isn't a file";
      reason = "unknown";
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      problem = "it doesn't exist";
    } else {
      problem = `it can't be read (${code ?? "unknown error"})`;
      reason = "unknown";
    }
  }
  if (problem) {
    throw new PromptAttachmentError(`Cannot attach ${attachment.path}: ${problem}.`, reason);
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
        // part came from promptParts, so path and label are its own.
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
