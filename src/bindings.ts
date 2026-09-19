/**
 * FFI bindings to the Foundation Models C dylib via koffi.
 * Load the lib once and expose typed wrappers for all C functions.
 */

import koffi from "koffi";
import { fileURLToPath } from "url";
import path from "path";
import { existsSync } from "fs";
import { macOSMajorVersion } from "./os.js";

export { macOSMajorVersion };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The dylib is placed in native/ by the build-native.sh script.
// When installed as a package, it lives next to dist/.
function findDylib(): string {
  const candidates = [
    path.join(__dirname, "..", "native", "libFoundationModels.dylib"),
    path.join(__dirname, "..", "..", "native", "libFoundationModels.dylib"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Could not find libFoundationModels.dylib.\n` +
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

let _lib: ReturnType<typeof koffi.load> | null = null;

function lib() {
  if (!_lib) {
    const dylibPath = findDylib();
    try {
      _lib = koffi.load(dylibPath);
    } catch (e) {
      throw new Error(
        `Failed to load Foundation Models dylib at ${dylibPath}.\n` +
          unsupportedOSHint() +
          `Run 'npm run build' first (needs Xcode 27).\n` +
          `Original error: ${e}`,
      );
    }
  }
  return _lib;
}

// ---------------------------------------------------------------------------
// Callback prototype definitions
// ---------------------------------------------------------------------------

// void (*)(int status, const char *content, size_t length, void *userInfo)
export const ResponseCallbackProto = koffi.proto("ResponseCallback", "void", [
  "int",
  "str",
  "size_t",
  "void *",
]);

// void (*)(int status, void *generatedContent, void *userInfo)
export const StructuredResponseCallbackProto = koffi.proto("StructuredResponseCallback", "void", [
  "int",
  "void *",
  "void *",
]);

// void (*)(int status, int tokenCount, const char *errorDescription, void *userInfo)
export const TokenCountCallbackProto = koffi.proto("TokenCountCallback", "void", [
  "int",
  "int",
  "str",
  "void *",
]);

// void (*)(void *generatedContent, unsigned int callId)
export const ToolCallbackProto = koffi.proto("ToolCallback", "void", ["void *", "uint"]);

// ---------------------------------------------------------------------------
// Lazy function accessors — defined once per process
// ---------------------------------------------------------------------------

let _funcs: ReturnType<typeof defineFunctions> | null = null;

// A string parameter the C header marks _Nullable. A plain `str` parameter is
// _Nonnull (tests/unit/bindings-signatures.test.ts keeps the two in sync).
koffi.alias("nullable_str", "str");

/** @internal A string parameter of a koffi signature. */
export interface StringParam {
  index: number;
  name: string;
  kind: "str" | "nullable_str" | "str_array";
}

/** @internal Reads the string parameters out of a koffi function signature. */
export function stringParams(signature: string): StringParam[] {
  const params = /\(([^)]*)\)\s*$/.exec(signature)?.[1] ?? "";
  return params
    .split(",")
    .map((p) => p.trim())
    .flatMap((param, index): StringParam[] => {
      const array = /^str\s*\*\s*(\w+)$/.exec(param);
      if (array) return [{ index, name: array[1], kind: "str_array" }];
      const single = /^(nullable_str|str)\s+(\w+)$/.exec(param);
      if (single) return [{ index, name: single[2], kind: single[1] as StringParam["kind"] }];
      return [];
    });
}

function describe(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * @internal Throws a TypeError for a string argument that isn't a string. koffi
 * passes a number given for a `str` parameter as a raw pointer, and null or
 * undefined as NULL, either of which crashes the host inside Swift. The public
 * API's types rule these out, but JavaScript callers can pass anything.
 */
export function checkStringArgs(
  functionName: string,
  params: StringParam[],
  args: unknown[],
): void {
  for (const param of params) {
    const value = args[param.index];
    if (param.kind === "nullable_str" && value == null) continue;
    if (param.kind === "str_array") {
      // Index every element: every() and find() skip the holes in a sparse
      // array, which would reach native code as NULL.
      const bad = Array.isArray(value)
        ? Array.from({ length: value.length }, (_, i) => i).find(
            (i) => typeof value[i] !== "string",
          )
        : undefined;
      if (Array.isArray(value) && bad === undefined) continue;
      throw new TypeError(
        `Expected an array of strings for "${param.name}" (${functionName}), got ` +
          (Array.isArray(value)
            ? `an array containing ${describe(value[bad!])} at index ${bad}`
            : describe(value)),
      );
    }
    if (typeof value !== "string") {
      throw new TypeError(
        `Expected a string for "${param.name}" (${functionName}), got ${describe(value)}`,
      );
    }
  }
}

function defineFunctions() {
  const l = lib();

  // Declares a function. Calls with string parameters check their arguments
  // first, because a wrong type there crashes the host instead of throwing.
  const fn = (sig: string) => {
    const native = l.func(sig);
    const params = stringParams(sig);
    if (params.length === 0) return native;
    const name = /\b(FM\w+)\s*\(/.exec(sig)?.[1] ?? "native function";
    const checked = (...args: unknown[]) => {
      checkStringArgs(name, params, args);
      return native(...args);
    };
    return Object.assign(checked, {
      info: native.info,
      async: (...args: unknown[]) => {
        checkStringArgs(name, params, args);
        return native.async(...args);
      },
    }) as typeof native;
  };

  return {
    // --- SystemLanguageModel ---
    FMSystemLanguageModelCreate: fn(
      "void * FMSystemLanguageModelCreate(int useCase, int guardrails)",
    ),
    FMSystemLanguageModelIsAvailable: fn(
      "bool FMSystemLanguageModelIsAvailable(void * model, _Out_ int * unavailableReason)",
    ),

    // --- Session creation ---
    // FMLanguageModelSessionCreateDefault: fn("void * FMLanguageModelSessionCreateDefault()"),
    // ^ unused: Python SDK also skips this — always route through CreateFromSystemLanguageModel
    FMLanguageModelSessionCreateFromSystemLanguageModel: fn(
      "void * FMLanguageModelSessionCreateFromSystemLanguageModel(void * model, nullable_str instructions, void * * tools, int toolCount)",
    ),
    FMLanguageModelSessionCreateFromTranscript: fn(
      "void * FMLanguageModelSessionCreateFromTranscript(void * transcriptSession, void * model, void * * tools, int toolCount)",
    ),

    // --- Session state ---
    FMLanguageModelSessionIsResponding: fn(
      "bool FMLanguageModelSessionIsResponding(void * session)",
    ),
    FMLanguageModelSessionReset: fn("void FMLanguageModelSessionReset(void * session)"),

    // --- Token counting ---
    // Each dispatches asynchronously and reports through the callback. The
    // returned task must be released, and may be cancelled with FMTaskCancel.
    FMSystemLanguageModelTokenCountForPrompt: fn(
      "void * FMSystemLanguageModelTokenCountForPrompt(void * model, void * composedPrompt, void * userInfo, TokenCountCallback * callback)",
    ),
    FMSystemLanguageModelTokenCountForInstructions: fn(
      "void * FMSystemLanguageModelTokenCountForInstructions(void * model, str instructions, void * userInfo, TokenCountCallback * callback)",
    ),
    FMSystemLanguageModelTokenCountForTools: fn(
      "void * FMSystemLanguageModelTokenCountForTools(void * model, void * * tools, int toolCount, void * userInfo, TokenCountCallback * callback)",
    ),
    FMSystemLanguageModelTokenCountForSchema: fn(
      "void * FMSystemLanguageModelTokenCountForSchema(void * model, void * schema, void * userInfo, TokenCountCallback * callback)",
    ),
    FMSystemLanguageModelTokenCountForTranscript: fn(
      "void * FMSystemLanguageModelTokenCountForTranscript(void * model, void * transcriptSession, void * userInfo, TokenCountCallback * callback)",
    ),
    FMTaskCancel: fn("void FMTaskCancel(void * task)"),

    // --- Prompt construction ---
    // FMComposedPromptInitialize returns a +1 reference; every path that builds
    // one must FMRelease it, including error and early-exit paths.
    FMComposedPromptInitialize: fn("void * FMComposedPromptInitialize()"),
    FMComposedPromptAddText: fn("void FMComposedPromptAddText(void * composedPrompt, str text)"),
    // Can't fail on macOS 27; the out-parameter is kept for ABI stability.
    FMComposedPromptAddAttachment: fn(
      "bool FMComposedPromptAddAttachment(void * composedPrompt, str imagePath, nullable_str label, _Out_ int * outError)",
    ),

    // --- Text generation ---
    FMLanguageModelSessionRespond: fn(
      "void * FMLanguageModelSessionRespond(void * session, void * composedPrompt, nullable_str optionsJSON, void * userInfo, ResponseCallback * callback)",
    ),

    // --- Structured generation ---
    FMLanguageModelSessionRespondWithSchema: fn(
      "void * FMLanguageModelSessionRespondWithSchema(void * session, void * composedPrompt, void * schema, nullable_str optionsJSON, void * userInfo, StructuredResponseCallback * callback)",
    ),
    FMLanguageModelSessionRespondWithSchemaFromJSON: fn(
      "void * FMLanguageModelSessionRespondWithSchemaFromJSON(void * session, void * composedPrompt, str schemaJSON, nullable_str optionsJSON, void * userInfo, StructuredResponseCallback * callback)",
    ),

    // --- Streaming ---
    FMLanguageModelSessionStreamResponse: fn(
      "void * FMLanguageModelSessionStreamResponse(void * session, void * composedPrompt, nullable_str optionsJSON)",
    ),
    FMLanguageModelSessionResponseStreamIterate: fn(
      "void FMLanguageModelSessionResponseStreamIterate(void * stream, void * userInfo, ResponseCallback * callback)",
    ),

    // --- Transcript ---
    FMLanguageModelSessionGetTranscriptJSONString: fn(
      "void * FMLanguageModelSessionGetTranscriptJSONString(void * session, void * outErrorCode, void * outErrorDesc)",
    ),
    FMTranscriptCreateFromJSONString: fn(
      "void * FMTranscriptCreateFromJSONString(str jsonString, _Out_ int * outErrorCode, void * outErrorDesc)",
    ),

    // --- GenerationSchema ---
    FMGenerationSchemaCreate: fn(
      "void * FMGenerationSchemaCreate(str name, nullable_str description)",
    ),
    FMGenerationSchemaPropertyCreate: fn(
      "void * FMGenerationSchemaPropertyCreate(str name, nullable_str description, str typeName, bool isOptional)",
    ),
    FMGenerationSchemaPropertyAddAnyOfGuide: fn(
      "void FMGenerationSchemaPropertyAddAnyOfGuide(void * property, str * anyOf, int choiceCount, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddRangeGuide: fn(
      "void FMGenerationSchemaPropertyAddRangeGuide(void * property, double min, double max, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddMinimumGuide: fn(
      "void FMGenerationSchemaPropertyAddMinimumGuide(void * property, double minimum, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddMaximumGuide: fn(
      "void FMGenerationSchemaPropertyAddMaximumGuide(void * property, double maximum, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddRegex: fn(
      "void FMGenerationSchemaPropertyAddRegex(void * property, str pattern, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddCountGuide: fn(
      "void FMGenerationSchemaPropertyAddCountGuide(void * property, int count, bool wrapped)",
    ),
    FMGenerationSchemaPropertyAddMinItemsGuide: fn(
      "void FMGenerationSchemaPropertyAddMinItemsGuide(void * property, int minItems)",
    ),
    FMGenerationSchemaPropertyAddMaxItemsGuide: fn(
      "void FMGenerationSchemaPropertyAddMaxItemsGuide(void * property, int maxItems)",
    ),
    FMGenerationSchemaAddProperty: fn(
      "void FMGenerationSchemaAddProperty(void * schema, void * property)",
    ),
    FMGenerationSchemaAddReferenceSchema: fn(
      "void FMGenerationSchemaAddReferenceSchema(void * schema, void * refSchema)",
    ),

    // --- GenerationSchema serialization ---
    FMGenerationSchemaGetJSONString: fn(
      "void * FMGenerationSchemaGetJSONString(void * schema, _Out_ int * outErrorCode, void * outErrorDesc)",
    ),

    // --- GeneratedContent ---
    FMGeneratedContentCreateFromJSON: fn(
      "void * FMGeneratedContentCreateFromJSON(str jsonString, _Out_ int * outErrorCode, void * outErrorDesc)",
    ),
    FMGeneratedContentGetJSONString: fn("void * FMGeneratedContentGetJSONString(void * content)"),
    FMGeneratedContentGetPropertyValue: fn(
      "void * FMGeneratedContentGetPropertyValue(void * content, str propertyName, void * outErrorCode, void * outErrorDesc)",
    ),
    FMGeneratedContentIsComplete: fn("bool FMGeneratedContentIsComplete(void * content)"),

    // --- Tool ---
    FMBridgedToolCreate: fn(
      "void * FMBridgedToolCreate(str name, str description, void * schema, ToolCallback * callable, _Out_ int * outErrorCode, void * outErrorDesc)",
    ),
    // Fails a pending call instead of answering it, ending the response with `code`.
    FMBridgedToolFailCall: fn(
      "void FMBridgedToolFailCall(void * tool, uint callId, int code, str message)",
    ),
    FMBridgedToolFinishCall: fn(
      "void FMBridgedToolFinishCall(void * tool, uint callId, str output)",
    ),

    // --- Task ---

    // --- tsfm extensions (not in Apple's C bridge) ---
    FMSystemLanguageModelGetContextSize: fn(
      "int FMSystemLanguageModelGetContextSize(void * model)",
    ),

    FMSystemLanguageModelGetSupportedLanguages: fn(
      "void * FMSystemLanguageModelGetSupportedLanguages(void * model)",
    ),
    FMSystemLanguageModelSupportsLocale: fn(
      "bool FMSystemLanguageModelSupportsLocale(void * model, str localeIdentifier)",
    ),
    FMLanguageModelSessionPrewarm: fn(
      "void FMLanguageModelSessionPrewarm(void * session, nullable_str promptPrefix)",
    ),
    // --- Model information (tsfm); free the results with FMFreeString ---
    FMSystemLanguageModelGetCapabilitiesJSON: fn(
      "void * FMSystemLanguageModelGetCapabilitiesJSON(void * model)",
    ),
    FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON: fn(
      "void * FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(void * model)",
    ),
    FMSystemLanguageModelGetVariantName: fn(
      "void * FMSystemLanguageModelGetVariantName(void * model)",
    ),

    // --- Private Cloud Compute (tsfm) ---
    FMPrivateCloudComputeLanguageModelCreate: fn(
      "void * FMPrivateCloudComputeLanguageModelCreate()",
    ),
    FMPrivateCloudComputeLanguageModelIsAvailable: fn(
      "bool FMPrivateCloudComputeLanguageModelIsAvailable(void * model, _Out_ int * unavailableReason)",
    ),
    FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON: fn(
      "void * FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON(void * model)",
    ),
    FMPrivateCloudComputeLanguageModelGetContextSize: fn(
      "void * FMPrivateCloudComputeLanguageModelGetContextSize(void * model, void * userInfo, TokenCountCallback * callback)",
    ),
    FMLanguageModelSessionCreateFromPrivateCloudComputeModel: fn(
      "void * FMLanguageModelSessionCreateFromPrivateCloudComputeModel(void * model, nullable_str instructions, void * * tools, int toolCount)",
    ),
    FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel: fn(
      "void * FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(void * transcriptSession, void * model, void * * tools, int toolCount)",
    ),

    // Cumulative token usage as JSON; free with FMFreeString (decodeAndFreeString).
    FMLanguageModelSessionGetUsageJSON: fn(
      "void * FMLanguageModelSessionGetUsageJSON(void * session)",
    ),

    // --- Memory ---
    // FMRetain: fn("void FMRetain(void * object)"),
    // ^ unused: all Swift→JS transfers are passRetained (+1 already), only FMRelease needed
    FMRelease: fn("void FMRelease(void * object)"),
    FMFreeString: fn("void FMFreeString(void * str)"),
  };
}

export function getFunctions() {
  if (!_funcs) _funcs = defineFunctions();
  return _funcs;
}

/**
 * Decode a null-terminated C string from a raw pointer and immediately free
 * the underlying C memory via FMFreeString. Returns null if the pointer is null.
 *
 * Use this for every char * return value from the C API (transcript JSON,
 * schema JSON, generated content JSON, property values) to avoid the leak
 * that occurs when koffi's 'str' return type copies the string but discards
 * the original pointer before we can free it.
 */
/**
 * Branded type for opaque C pointers returned by koffi FFI calls.
 * Prevents accidentally mixing native handles with other values.
 */
declare const _nativePointer: unique symbol;
export type NativePointer = { readonly [_nativePointer]: never };

/** The type of a koffi callback proto created by `koffi.proto()`. */
export type CallbackProto = typeof ResponseCallbackProto;

/** The type returned by `koffi.register()` — a handle to a native callback. */
export type KoffiCallback = ReturnType<typeof koffi.register>;

/** Unregister a koffi callback. */
export function unregisterCallback(callback: KoffiCallback): void {
  koffi.unregister(callback);
}

/**
 * Decode a null-terminated C string from a raw pointer without freeing it.
 * Returns null if the pointer is null.
 *
 * Use this for callback parameters where the C side owns the memory.
 */
export function decodeString(pointer: NativePointer | null): string | null {
  if (!pointer) return null;
  // 'char *' would treat pointer as char** (pointer-to-pointer) and segfault.
  // 'char' with -1 reads the null-terminated byte sequence at pointer directly.
  // koffi may return a string or an array of char codes depending on version;
  // we handle both and re-encode via TextDecoder to preserve UTF-8.
  const raw = koffi.decode(pointer, "char", -1);
  if (typeof raw === "string") return raw;
  const codes: number[] = raw;
  return new TextDecoder("utf-8").decode(new Uint8Array(codes.map((c) => c & 0xff)));
}

export function decodeAndFreeString(pointer: NativePointer | null): string | null {
  const str = decodeString(pointer);
  if (pointer) getFunctions().FMFreeString(pointer);
  return str;
}
