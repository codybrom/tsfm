/**
 * FFI bindings to the Foundation Models C dylib via koffi.
 * Load the lib once and expose typed wrappers for all C functions.
 */

import koffi from "koffi";
import { fileURLToPath } from "url";
import path from "path";
import { existsSync } from "fs";

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
  return candidates[0]; // let koffi produce the real error
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
          `Run 'npm run build' first. Requires macOS 26+, Xcode 26+.\n` +
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

// void (*)(void *generatedContent, unsigned int callId)
export const ToolCallbackProto = koffi.proto("ToolCallback", "void", ["void *", "uint"]);

// ---------------------------------------------------------------------------
// Lazy function accessors — defined once per process
// ---------------------------------------------------------------------------

let _funcs: ReturnType<typeof defineFunctions> | null = null;

function defineFunctions() {
  const l = lib();

  // Helper to declare functions
  const fn = (sig: string) => l.func(sig);

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
      "void * FMLanguageModelSessionCreateFromSystemLanguageModel(void * model, str instructions, void * * tools, int toolCount)",
    ),
    FMLanguageModelSessionCreateFromTranscript: fn(
      "void * FMLanguageModelSessionCreateFromTranscript(void * transcriptSession, void * model, void * * tools, int toolCount)",
    ),

    // --- Session state ---
    FMLanguageModelSessionIsResponding: fn(
      "bool FMLanguageModelSessionIsResponding(void * session)",
    ),
    FMLanguageModelSessionReset: fn("void FMLanguageModelSessionReset(void * session)"),

    // --- Text generation ---
    FMLanguageModelSessionRespond: fn(
      "void * FMLanguageModelSessionRespond(void * session, str prompt, str optionsJSON, void * userInfo, ResponseCallback * callback)",
    ),

    // --- Structured generation ---
    FMLanguageModelSessionRespondWithSchema: fn(
      "void * FMLanguageModelSessionRespondWithSchema(void * session, str prompt, void * schema, str optionsJSON, void * userInfo, StructuredResponseCallback * callback)",
    ),
    FMLanguageModelSessionRespondWithSchemaFromJSON: fn(
      "void * FMLanguageModelSessionRespondWithSchemaFromJSON(void * session, str prompt, str schemaJSON, str optionsJSON, void * userInfo, StructuredResponseCallback * callback)",
    ),

    // --- Streaming ---
    FMLanguageModelSessionStreamResponse: fn(
      "void * FMLanguageModelSessionStreamResponse(void * session, str prompt, str optionsJSON)",
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
    FMGenerationSchemaCreate: fn("void * FMGenerationSchemaCreate(str name, str description)"),
    FMGenerationSchemaPropertyCreate: fn(
      "void * FMGenerationSchemaPropertyCreate(str name, str description, str typeName, bool isOptional)",
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
    FMBridgedToolFinishCall: fn(
      "void FMBridgedToolFinishCall(void * tool, uint callId, str output)",
    ),

    // --- Task ---
    FMTaskCancel: fn("void FMTaskCancel(void * task)"),

    // --- tsfm extensions (not in Apple's C bridge) ---
    FMSystemLanguageModelGetContextSize: fn(
      "int FMSystemLanguageModelGetContextSize(void * model)",
    ),

    // macOS 26.4+ runtime only — uncomment when targeting 26.4+
    // FMSystemLanguageModelGetTokenCount: fn(
    //   "int FMSystemLanguageModelGetTokenCount(void * model, str text)",
    // ),

    FMSystemLanguageModelGetSupportedLanguages: fn(
      "void * FMSystemLanguageModelGetSupportedLanguages(void * model)",
    ),
    FMSystemLanguageModelSupportsLocale: fn(
      "bool FMSystemLanguageModelSupportsLocale(void * model, str localeIdentifier)",
    ),
    FMLanguageModelSessionPrewarm: fn(
      "void FMLanguageModelSessionPrewarm(void * session, str promptPrefix)",
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
