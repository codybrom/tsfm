/**
 * The native binding: tsfm's Node-API addon (native/tsfm.node) over the
 * Foundation Models bridge (native/libFoundationModels.dylib).
 *
 * The addon does the unsafe parts in C. Native objects arrive as opaque
 * handles; passing the wrong kind, or one already released, throws instead of
 * reaching Swift. Strings are checked and copied, and native callbacks reach
 * JavaScript only while it can receive them. See native/addon/tsfm_addon.c.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { macOSMajorVersion } from "./os.js";

export { macOSMajorVersion };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare const _nativeHandle: unique symbol;
/** An opaque handle to a native object. */
export type NativePointer = { readonly [_nativeHandle]: never };
/** A handle to an in-flight request, for cancelling it. */
export type RequestHandle = NativePointer;

/** An out-parameter result: `value` is null on failure, with `status` and `description`. */
export interface NativeResult<T> {
  value: T | null;
  status: number;
  description: string | null;
}

export interface NativeAvailability {
  available: boolean;
  /** Present when `available` is false. */
  reason: number | null;
}

export interface TextResult {
  status: number;
  text: string | null;
}

export interface StructuredResult {
  status: number;
  /** The generated content on success; the caller owns it. */
  content: NativePointer | null;
  /** The error message on failure. */
  message: string | null;
}

export interface CountResult {
  status: number;
  count: number;
  message: string | null;
}

/** A started one-shot request: its result, and a handle to cancel it. */
export type Started<T> = [Promise<T>, RequestHandle];

/** The addon's exports. Names match the C functions they wrap. */
export interface NativeFunctions {
  FMSystemLanguageModelCreate(useCase: number, guardrails: number): NativePointer;
  FMSystemLanguageModelIsAvailable(model: NativePointer): NativeAvailability;
  FMSystemLanguageModelGetContextSize(model: NativePointer): number;
  FMSystemLanguageModelGetVariantName(model: NativePointer): string | null;
  FMSystemLanguageModelGetCapabilitiesJSON(model: NativePointer): string | null;
  FMSystemLanguageModelGetSupportedLanguages(model: NativePointer): string | null;
  FMSystemLanguageModelSupportsLocale(model: NativePointer, locale: string): boolean;
  FMSystemLanguageModelTokenCountForPrompt(
    model: NativePointer,
    prompt: NativePointer,
  ): Started<CountResult>;
  FMSystemLanguageModelTokenCountForInstructions(
    model: NativePointer,
    instructions: string,
  ): Started<CountResult>;
  FMSystemLanguageModelTokenCountForTools(
    model: NativePointer,
    tools: NativePointer[],
  ): Started<CountResult>;
  FMSystemLanguageModelTokenCountForSchema(
    model: NativePointer,
    schema: NativePointer,
  ): Started<CountResult>;
  FMSystemLanguageModelTokenCountForTranscript(
    model: NativePointer,
    transcript: NativePointer,
  ): Started<CountResult>;

  FMPrivateCloudComputeLanguageModelCreate(): NativePointer | null;
  FMPrivateCloudComputeLanguageModelIsAvailable(model: NativePointer): NativeAvailability;
  FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(model: NativePointer): string | null;
  FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON(model: NativePointer): string | null;
  FMPrivateCloudComputeLanguageModelGetContextSize(model: NativePointer): Started<CountResult>;

  FMLanguageModelSessionCreateFromSystemLanguageModel(
    model: NativePointer | null,
    instructions: string | null,
    tools: NativePointer[],
  ): NativePointer | null;
  FMLanguageModelSessionCreateFromPrivateCloudComputeModel(
    model: NativePointer,
    instructions: string | null,
    tools: NativePointer[],
  ): NativePointer | null;
  FMLanguageModelSessionCreateFromTranscript(
    transcript: NativePointer,
    model: NativePointer | null,
    tools: NativePointer[],
  ): NativePointer | null;
  FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(
    transcript: NativePointer,
    model: NativePointer,
    tools: NativePointer[],
  ): NativePointer | null;
  FMLanguageModelSessionIsResponding(session: NativePointer): boolean;
  FMLanguageModelSessionReset(session: NativePointer): void;
  FMLanguageModelSessionPrewarm(session: NativePointer, promptPrefix: string | null): void;
  FMLanguageModelSessionGetUsageJSON(session: NativePointer): string | null;
  FMLanguageModelSessionGetTranscriptJSONString(session: NativePointer): NativeResult<string>;
  FMLanguageModelSessionRespond(
    session: NativePointer,
    prompt: NativePointer,
    optionsJSON: string | null,
  ): Started<TextResult>;
  FMLanguageModelSessionRespondWithSchema(
    session: NativePointer,
    prompt: NativePointer,
    schema: NativePointer,
    optionsJSON: string | null,
  ): Started<StructuredResult>;
  FMLanguageModelSessionRespondWithSchemaFromJSON(
    session: NativePointer,
    prompt: NativePointer,
    schemaJSON: string,
    optionsJSON: string | null,
  ): Started<StructuredResult>;
  /**
   * Starts a stream. `onChunk` receives cumulative snapshots, then a final
   * call: `text` null for the end, or a non-zero `status` for an error. Null if
   * the stream couldn't start.
   */
  FMLanguageModelSessionStreamResponse(
    session: NativePointer,
    prompt: NativePointer,
    optionsJSON: string | null,
    onChunk: (status: number, text: string | null) => void,
  ): RequestHandle | null;
  FMTranscriptCreateFromJSONString(json: string): NativeResult<NativePointer>;

  FMComposedPromptInitialize(): NativePointer;
  FMComposedPromptAddText(prompt: NativePointer, text: string): void;
  /** 0 when added, otherwise an FMComposedPromptAddImageError code. */
  FMComposedPromptAddAttachment(prompt: NativePointer, path: string, label: string | null): number;

  FMGenerationSchemaCreate(name: string, description: string | null): NativePointer;
  FMGenerationSchemaPropertyCreate(
    name: string,
    description: string | null,
    typeName: string,
    isOptional: boolean,
  ): NativePointer;
  FMGenerationSchemaAddProperty(schema: NativePointer, property: NativePointer): void;
  FMGenerationSchemaAddReferenceSchema(schema: NativePointer, reference: NativePointer): void;
  FMGenerationSchemaGetJSONString(schema: NativePointer): NativeResult<string>;
  FMGenerationSchemaPropertyAddAnyOfGuide(
    property: NativePointer,
    choices: string[],
    wrapped: boolean,
  ): void;
  FMGenerationSchemaPropertyAddCountGuide(
    property: NativePointer,
    count: number,
    wrapped: boolean,
  ): void;
  FMGenerationSchemaPropertyAddMaxItemsGuide(property: NativePointer, maxItems: number): void;
  FMGenerationSchemaPropertyAddMinItemsGuide(property: NativePointer, minItems: number): void;
  FMGenerationSchemaPropertyAddMaximumGuide(
    property: NativePointer,
    maximum: number,
    wrapped: boolean,
  ): void;
  FMGenerationSchemaPropertyAddMinimumGuide(
    property: NativePointer,
    minimum: number,
    wrapped: boolean,
  ): void;
  FMGenerationSchemaPropertyAddRangeGuide(
    property: NativePointer,
    min: number,
    max: number,
    wrapped: boolean,
  ): void;
  FMGenerationSchemaPropertyAddRegex(
    property: NativePointer,
    pattern: string,
    wrapped: boolean,
  ): void;

  FMGeneratedContentCreateFromJSON(json: string): NativeResult<NativePointer>;
  FMGeneratedContentIsComplete(content: NativePointer): boolean;
  FMGeneratedContentGetJSONString(content: NativePointer): string | null;
  FMGeneratedContentGetPropertyValue(content: NativePointer, name: string): NativeResult<string>;

  /**
   * Creates a tool. `onCall` receives each call's arguments (the caller owns
   * the content) and an id to answer with FMBridgedToolFinishCall or
   * FMBridgedToolFailCall.
   */
  FMBridgedToolCreate(
    name: string,
    description: string,
    schema: NativePointer,
    onCall: (content: NativePointer | null, callId: number) => void,
  ): NativeResult<NativePointer>;
  /** Whether the call was still pending (a released tool fails its pending calls). */
  FMBridgedToolFinishCall(tool: NativePointer, callId: number, output: string): boolean;
  FMBridgedToolFailCall(
    tool: NativePointer,
    callId: number,
    code: number,
    message: string,
  ): boolean;

  FMRequestCancel(request: RequestHandle): void;
  /** Drops JavaScript's reference to a native object. Idempotent. */
  FMRelease(handle: NativePointer | null): void;
  /** Cuts in-flight requests and tools off from JavaScript; for process exit. */
  FMShutdown(): void;
}

// The addon is placed in native/ by build-native.sh. When installed as a
// package, it lives next to dist/.
function findAddon(): string {
  const candidates = [
    path.join(__dirname, "..", "native", "tsfm.node"),
    path.join(__dirname, "..", "..", "native", "tsfm.node"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Could not find tsfm.node.\n` +
      `Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n` +
      `Run 'npm run build' to compile the native library (needs Xcode 27).`,
  );
}

/**
 * A hint for a failed load. tsfm's library targets macOS 26, and dyld refuses
 * it on older systems with an error that doesn't say so. It only explains a
 * failure and never blocks a load.
 */
export function unsupportedOSHint(macOSMajor = macOSMajorVersion()): string {
  if (process.platform !== "darwin") {
    return "Apple Foundation Models only runs on macOS.\n";
  }
  if (macOSMajor !== null && macOSMajor < 26) {
    return `tsfm requires macOS 26 or later (this is macOS ${macOSMajor}).\n`;
  }
  return "";
}

let _funcs: NativeFunctions | null = null;

/** The native functions, loading the addon on first use. */
export function getFunctions(): NativeFunctions {
  if (_funcs) return _funcs;
  const addonPath = findAddon();
  let funcs: NativeFunctions;
  try {
    funcs = createRequire(import.meta.url)(addonPath) as NativeFunctions;
  } catch (e) {
    throw new Error(
      `Failed to load the tsfm native addon at ${addonPath}.\n` +
        unsupportedOSHint() +
        `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // process.exit() skips Node-API's env cleanup hooks, so cut native callbacks
  // off from JavaScript here instead.
  process.on("exit", () => funcs.FMShutdown());
  _funcs = funcs;
  return funcs;
}
