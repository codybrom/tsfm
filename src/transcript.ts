import { getFunctions, decodeAndFreeString, type NativePointer } from "./bindings.js";
import { statusToError, FoundationModelsError } from "./errors.js";
import type { JsonSchema, JsonObject } from "./schema.js";

export type TranscriptEntryRole = "instructions" | "user" | "response" | "tool";

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
  // response-specific
  toolCalls?: TranscriptToolCall[];
  assets?: string[];
  // tool-specific
  toolName?: string;
  toolCallID?: string;
}

export class Transcript {
  /** @internal raw session pointer — backs the live session's native handle */
  _nativeSession: NativePointer;

  /** @internal */
  constructor(sessionPointer: NativePointer) {
    this._nativeSession = sessionPointer;
  }

  /** @internal Update the native session after fromTranscript(). */
  _updateNativeSession(pointer: NativePointer): void {
    this._nativeSession = pointer;
  }

  /**
   * Export the current session history as a JSON string for persistence.
   *
   * **Lifetime note:** instances created by `new LanguageModelSession()` or
   * `LanguageModelSession.fromTranscript()` are backed by the live session's
   * C state. Calling `toJson()` after `session.dispose()` will dereference a
   * freed pointer. Export the transcript before disposing the session.
   *
   * Instances created via the static `Transcript.fromJson()` /
   * `Transcript.fromDict()` constructors are independent C objects and are
   * safe to use after the originating session is disposed.
   */
  toJson(): string {
    const pointer = getFunctions().FMLanguageModelSessionGetTranscriptJSONString(
      this._nativeSession,
      null,
      null,
    );
    const json = decodeAndFreeString(pointer);
    if (!json) throw new FoundationModelsError("Failed to export transcript");
    return json;
  }

  /** Export the transcript as a parsed dictionary (mirrors Python's Transcript.to_dict()). */
  toDict(): JsonObject {
    return JSON.parse(this.toJson());
  }

  /** Return the typed transcript entries from the native JSON. */
  entries(): TranscriptEntry[] {
    const data = JSON.parse(this.toJson());
    const entries = data?.transcript?.entries;
    return Array.isArray(entries) ? entries : [];
  }

  /** Deserialize a previously exported transcript JSON string. */
  static fromJson(json: string): Transcript {
    const fn = getFunctions();
    const errorCode = [0];
    const pointer = fn.FMTranscriptCreateFromJSONString(json, errorCode, null);
    if (!pointer) {
      throw statusToError(errorCode[0], "Failed to deserialize transcript");
    }
    return new Transcript(pointer);
  }

  /** Deserialize a transcript from a dictionary (mirrors Python's Transcript.from_dict()). */
  static fromDict(dict: JsonObject): Transcript {
    return Transcript.fromJson(JSON.stringify(dict));
  }
}
