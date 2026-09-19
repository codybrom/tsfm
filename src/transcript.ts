import { getFunctions, decodeAndFreeString, type NativePointer } from "./bindings.js";
import { statusToError, FoundationModelsError } from "./errors.js";
import type { JsonSchema, JsonObject } from "./schema.js";

/** `"reasoning"` entries come from Private Cloud Compute requests with a `reasoningLevel`. */
export type TranscriptEntryRole = "instructions" | "user" | "response" | "tool" | "reasoning";

export interface TranscriptTextContent {
  type: "text";
  text: string;
  id: string;
}

export interface TranscriptStructuredContent {
  type: "structure";
  id: string;
  structure: { source: string; content: JsonObject };
}

export type TranscriptContent = TranscriptTextContent | TranscriptStructuredContent;

export interface TranscriptToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptEntryRole;
  contents?: TranscriptContent[];
  // instructions-specific
  tools?: JsonObject[];
  // user-specific
  options?: JsonObject;
  responseFormat?: JsonSchema;
  /** Context options the request used, e.g. `{ reasoningLevel: "deep" }`. */
  contextOptions?: JsonObject;
  // response-specific
  toolCalls?: TranscriptToolCall[];
  assets?: string[];
  // tool-specific
  toolName?: string;
  toolCallID?: string;
  // reasoning-specific (Private Cloud Compute)
  reasoning?: {
    /** The model's reasoning text, when it's shared. Often empty. */
    contents: TranscriptContent[];
    /** An opaque signature the model uses to continue from this reasoning. */
    signature?: string;
  };
  /** Model and system details recorded with the entry. */
  metadata?: JsonObject;
}

const _transcriptRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch (err) {
    console.warn("[tsfm] Transcript cleanup via FinalizationRegistry failed:", err);
  }
});

export class Transcript {
  /** @internal raw session pointer — backs the live session's native handle */
  _nativeSession: NativePointer;

  /**
   * Whether this instance owns its C object.
   *
   * Instances handed a live session's pointer do not: `LanguageModelSession`
   * releases that pointer, and releasing it here as well would be a double
   * free. Only the standalone objects from `fromJson()` / `fromDict()` are
   * this instance's to free.
   */
  private _owned: boolean;

  private _disposed = false;
  /** Set when the session backing this transcript is disposed. */
  private _detached = false;

  /** @internal */
  constructor(sessionPointer: NativePointer, owned = false) {
    this._nativeSession = sessionPointer;
    this._owned = owned;
    if (owned) _transcriptRegistry.register(this, sessionPointer, this);
  }

  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw new FoundationModelsError("Transcript has been disposed");
    }
    if (this._detached) {
      throw new FoundationModelsError(
        "The session this transcript belongs to has been disposed. " +
          "Export the transcript before disposing the session.",
      );
    }
  }

  /**
   * @internal Called when the backing session is disposed. Its pointer is
   * released, and reading through it would crash the host.
   */
  _detach(): void {
    if (!this._owned) this._detached = true;
  }

  /** @internal Release the C object this instance owns, if any. */
  private _releaseIfOwned(): void {
    if (!this._owned) return;
    _transcriptRegistry.unregister(this);
    getFunctions().FMRelease(this._nativeSession);
    this._owned = false;
  }

  /** @internal Update the native session after fromTranscript(). */
  _updateNativeSession(pointer: NativePointer): void {
    // fromTranscript() repoints this instance at the session it just built.
    // Release the deserialized object first, or it is orphaned with no handle
    // left to free it. The session owns the incoming pointer, not this class.
    this._releaseIfOwned();
    this._nativeSession = pointer;
  }

  /**
   * Release the C object backing a standalone transcript. Safe to call more
   * than once, and a no-op for transcripts backed by a live session, which
   * `LanguageModelSession.dispose()` frees instead.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._releaseIfOwned();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Export the current session history as a JSON string for persistence.
   *
   * **Lifetime note:** instances created by `new LanguageModelSession()` or
   * `LanguageModelSession.fromTranscript()` are backed by the live session's
   * C state. Export the transcript before disposing the session; afterwards
   * `toJson()` throws.
   *
   * Instances created via the static `Transcript.fromJson()` /
   * `Transcript.fromDict()` constructors are independent C objects and are
   * safe to use after the originating session is disposed.
   */
  toJson(): string {
    this._assertNotDisposed();
    const pointer = getFunctions().FMLanguageModelSessionGetTranscriptJSONString(
      this._nativeSession,
      null,
      null,
    ) as NativePointer | null;
    const json = decodeAndFreeString(pointer);
    if (!json) throw new FoundationModelsError("Failed to export transcript");
    return json;
  }

  /** Export the transcript as a parsed dictionary (mirrors Python's Transcript.to_dict()). */
  toDict(): JsonObject {
    const json = this.toJson();
    try {
      return JSON.parse(json);
    } catch {
      throw new FoundationModelsError(`Failed to parse transcript JSON: ${json.slice(0, 200)}`);
    }
  }

  /** Return the typed transcript entries from the native JSON. */
  entries(): TranscriptEntry[] {
    const data = this.toDict();
    const entries = (data as { transcript?: { entries?: unknown[] } })?.transcript?.entries;
    return Array.isArray(entries) ? (entries as TranscriptEntry[]) : [];
  }

  /** Deserialize a previously exported transcript JSON string. */
  static fromJson(json: string): Transcript {
    const fn = getFunctions();
    const errorCode = [0];
    const pointer = fn.FMTranscriptCreateFromJSONString(
      json,
      errorCode,
      null,
    ) as NativePointer | null;
    if (!pointer) {
      throw statusToError(errorCode[0], "Failed to deserialize transcript");
    }
    return new Transcript(pointer, true);
  }

  /** Deserialize a transcript from a dictionary (mirrors Python's Transcript.from_dict()). */
  static fromDict(dict: JsonObject): Transcript {
    return Transcript.fromJson(JSON.stringify(dict));
  }
}
