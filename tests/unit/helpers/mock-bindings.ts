import { vi } from "vitest";

/** A one-shot request that never settles unless a test resolves it. */
function pending(): [Promise<never>, string] {
  return [new Promise<never>(() => {}), "mock-request"];
}

/** An out-parameter result that succeeded. */
export function ok<T>(value: T) {
  return { value, status: 0, description: null as string | null };
}

/** An out-parameter result that failed with `status`. */
export function failed(status: number, description: string | null = null) {
  return { value: null, status, description };
}

/** A started one-shot request that resolves at once with `result`. */
export function started<T>(result: T): [Promise<T>, string] {
  return [Promise.resolve(result), "mock-request"];
}

type OnChunk = (status: number, text: string | null) => void;
type OnCall = (content: string | null, callId: number) => void;

/**
 * Mocks of the Node-API addon's exports (src/bindings.ts NativeFunctions).
 * Handles are plain strings. One-shot requests stay pending unless a test
 * overrides them; streams and tools receive their JS callbacks as arguments.
 */
export function createMockFunctions() {
  return {
    // SystemLanguageModel
    FMSystemLanguageModelCreate: vi.fn(
      (_useCase: number, _guardrails: number): string | null => "mock-model-pointer",
    ),
    FMSystemLanguageModelIsAvailable: vi.fn(
      (_model: unknown): { available: boolean; reason: number | null } => ({
        available: true,
        reason: null,
      }),
    ),
    FMSystemLanguageModelGetContextSize: vi.fn((_model: unknown) => 4096),
    FMSystemLanguageModelGetSupportedLanguages: vi.fn((_model: unknown): string | null => null),
    FMSystemLanguageModelSupportsLocale: vi.fn((_model: unknown, _locale: string) => true),
    FMSystemLanguageModelGetCapabilitiesJSON: vi.fn((_model: unknown): string | null => null),
    FMSystemLanguageModelGetVariantName: vi.fn((_model: unknown): string | null => null),

    // Token counting: [Promise<{ status, count, message }>, request]
    FMSystemLanguageModelTokenCountForPrompt: vi.fn((..._args: unknown[]) => pending()),
    FMSystemLanguageModelTokenCountForInstructions: vi.fn((..._args: unknown[]) => pending()),
    FMSystemLanguageModelTokenCountForTools: vi.fn((..._args: unknown[]) => pending()),
    FMSystemLanguageModelTokenCountForSchema: vi.fn((..._args: unknown[]) => pending()),
    FMSystemLanguageModelTokenCountForTranscript: vi.fn((..._args: unknown[]) => pending()),

    // Prompt construction
    FMComposedPromptInitialize: vi.fn((): string => "mock-composed-prompt"),
    FMComposedPromptAddText: vi.fn((_prompt: unknown, _text: string) => {}),
    /** 0 when added, otherwise an FMComposedPromptAddImageError code. */
    FMComposedPromptAddAttachment: vi.fn(
      (_prompt: unknown, _path: string, _label: string | null): number => 0,
    ),

    // Sessions
    FMLanguageModelSessionCreateFromSystemLanguageModel: vi.fn(
      (..._args: unknown[]): string | null => "mock-session-pointer",
    ),
    FMLanguageModelSessionCreateFromTranscript: vi.fn(
      (..._args: unknown[]): string | null => "mock-session-pointer",
    ),
    FMLanguageModelSessionIsResponding: vi.fn((_session: unknown) => false),
    FMLanguageModelSessionReset: vi.fn((_session: unknown) => {}),
    FMLanguageModelSessionPrewarm: vi.fn((_session: unknown, _prefix: string | null) => {}),
    // null reads as "usage unavailable"; tests that check usage override this.
    FMLanguageModelSessionGetUsageJSON: vi.fn((_session: unknown): string | null => null),

    // Requests: [Promise<result>, request]; pending unless a test settles them
    FMLanguageModelSessionRespond: vi.fn((..._args: unknown[]) => pending()),
    FMLanguageModelSessionRespondWithSchema: vi.fn((..._args: unknown[]) => pending()),
    FMLanguageModelSessionRespondWithSchemaFromJSON: vi.fn((..._args: unknown[]) => pending()),
    /** Returns a request handle; never calls onChunk unless a test does. */
    FMLanguageModelSessionStreamResponse: vi.fn(
      (_session: unknown, _prompt: unknown, _options: unknown, _onChunk: OnChunk): string | null =>
        "mock-stream-request",
    ),
    FMRequestCancel: vi.fn((_request: unknown) => {}),

    // Transcripts
    FMLanguageModelSessionGetTranscriptJSONString: vi.fn((_session: unknown) =>
      ok<string | null>(
        '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}',
      ),
    ),
    FMTranscriptCreateFromJSONString: vi.fn((_json: string) =>
      ok<string | null>("mock-transcript-pointer"),
    ),

    // GenerationSchema
    FMGenerationSchemaCreate: vi.fn(
      (_name: string, _description: string | null): string => "mock-schema-pointer",
    ),
    FMGenerationSchemaPropertyCreate: vi.fn(
      (_name: string, _description: string | null, _type: string, _optional: boolean): string =>
        "mock-prop-pointer",
    ),
    FMGenerationSchemaPropertyAddAnyOfGuide: vi.fn(
      (_property: unknown, _choices: string[], _wrapped: boolean) => {},
    ),
    FMGenerationSchemaPropertyAddRangeGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddMinimumGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddMaximumGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddRegex: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddCountGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddMinItemsGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaPropertyAddMaxItemsGuide: vi.fn((..._args: unknown[]) => {}),
    FMGenerationSchemaAddProperty: vi.fn((_schema: unknown, _property: unknown) => {}),
    FMGenerationSchemaAddReferenceSchema: vi.fn((_schema: unknown, _reference: unknown) => {}),
    FMGenerationSchemaGetJSONString: vi.fn((_schema: unknown) => ok<string | null>("{}")),

    // GeneratedContent
    FMGeneratedContentCreateFromJSON: vi.fn((_json: string) =>
      ok<string | null>("mock-content-pointer"),
    ),
    FMGeneratedContentGetJSONString: vi.fn((_content: unknown): string | null => '{"key":"value"}'),
    FMGeneratedContentGetPropertyValue: vi.fn((_content: unknown, _name: string) =>
      ok<string | null>(null),
    ),
    FMGeneratedContentIsComplete: vi.fn((_content: unknown) => true),

    // Tools
    FMBridgedToolCreate: vi.fn(
      (_name: string, _description: string, _schema: unknown, _onCall: OnCall) =>
        ok<string | null>("mock-tool-pointer"),
    ),
    FMBridgedToolFinishCall: vi.fn(
      (_tool: unknown, _callId: number, _output: string): boolean => true,
    ),
    FMBridgedToolFailCall: vi.fn(
      (_tool: unknown, _callId: number, _code: number, _message: string): boolean => true,
    ),

    // Private Cloud Compute
    FMPrivateCloudComputeLanguageModelCreate: vi.fn((): string | null => "mock-pcc-pointer"),
    FMPrivateCloudComputeLanguageModelIsAvailable: vi.fn(
      (_model: unknown): { available: boolean; reason: number | null } => ({
        available: false,
        reason: 3,
      }),
    ),
    FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON: vi.fn(
      (_model: unknown): string | null => null,
    ),
    FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON: vi.fn(
      (_model: unknown): string | null => null,
    ),
    FMPrivateCloudComputeLanguageModelGetSupportedLanguages: vi.fn(
      (_model: unknown): string | null => null,
    ),
    FMPrivateCloudComputeLanguageModelSupportsLocale: vi.fn(
      (_model: unknown, _locale: string) => true,
    ),
    FMPrivateCloudComputeLanguageModelGetContextSize: vi.fn((_model: unknown) => pending()),
    FMLanguageModelSessionCreateFromPrivateCloudComputeModel: vi.fn(
      (..._args: unknown[]): string | null => "mock-pcc-session",
    ),
    FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel: vi.fn(
      (..._args: unknown[]): string | null => "mock-pcc-session",
    ),

    // Lifetime
    FMRelease: vi.fn((_handle: unknown) => {}),
    FMShutdown: vi.fn(() => {}),
  };
}

export type MockFunctions = ReturnType<typeof createMockFunctions>;
