import { vi } from "vitest";

export function createMockFunctions() {
  return {
    // SystemLanguageModel
    FMSystemLanguageModelCreate: vi.fn((): string | null => "mock-model-pointer"),
    FMSystemLanguageModelIsAvailable: vi.fn((_pointer: unknown, reasonOut: number[]) => {
      reasonOut[0] = 0;
      return true;
    }),

    // Session creation
    FMLanguageModelSessionCreateFromSystemLanguageModel: vi.fn(
      (): string | null => "mock-session-pointer",
    ),
    FMLanguageModelSessionCreateFromTranscript: vi.fn((): string | null => "mock-session-pointer"),

    // Session state
    FMLanguageModelSessionIsResponding: vi.fn(() => false),
    FMLanguageModelSessionReset: vi.fn(),

    // Text generation
    FMLanguageModelSessionRespond: vi.fn((..._args: unknown[]): string => "mock-task-pointer"),

    // Structured generation
    FMLanguageModelSessionRespondWithSchema: vi.fn(
      (..._args: unknown[]): string => "mock-task-pointer",
    ),
    FMLanguageModelSessionRespondWithSchemaFromJSON: vi.fn(
      (..._args: unknown[]): string => "mock-task-pointer",
    ),

    // Streaming
    FMLanguageModelSessionStreamResponse: vi.fn(() => "mock-stream-pointer"),
    FMLanguageModelSessionResponseStreamIterate: vi.fn(),

    // Transcript
    FMLanguageModelSessionGetTranscriptJSONString: vi.fn(() => "mock-json-pointer"),
    FMTranscriptCreateFromJSONString: vi.fn(
      (_json: string): string | null => "mock-transcript-pointer",
    ),

    // GenerationSchema
    FMGenerationSchemaCreate: vi.fn(() => "mock-schema-pointer"),
    FMGenerationSchemaPropertyCreate: vi.fn(() => "mock-prop-pointer"),
    FMGenerationSchemaPropertyAddAnyOfGuide: vi.fn(),
    FMGenerationSchemaPropertyAddRangeGuide: vi.fn(),
    FMGenerationSchemaPropertyAddMinimumGuide: vi.fn(),
    FMGenerationSchemaPropertyAddMaximumGuide: vi.fn(),
    FMGenerationSchemaPropertyAddRegex: vi.fn(),
    FMGenerationSchemaPropertyAddCountGuide: vi.fn(),
    FMGenerationSchemaPropertyAddMinItemsGuide: vi.fn(),
    FMGenerationSchemaPropertyAddMaxItemsGuide: vi.fn(),
    FMGenerationSchemaAddProperty: vi.fn(),
    FMGenerationSchemaAddReferenceSchema: vi.fn(),

    // GenerationSchema serialization
    FMGenerationSchemaGetJSONString: vi.fn(() => "mock-json-pointer"),

    // GeneratedContent
    FMGeneratedContentCreateFromJSON: vi.fn((): string | null => "mock-content-pointer"),
    FMGeneratedContentGetJSONString: vi.fn((): string | null => "mock-json-pointer"),
    FMGeneratedContentGetPropertyValue: vi.fn((): string | null => null),
    FMGeneratedContentIsComplete: vi.fn(() => true),

    // Tool
    FMBridgedToolCreate: vi.fn((): string | null => "mock-tool-pointer"),
    FMBridgedToolFinishCall: vi.fn(),

    // Task
    FMTaskCancel: vi.fn(),

    // tsfm extensions
    FMSystemLanguageModelGetContextSize: vi.fn(() => 4096),
    FMSystemLanguageModelGetSupportedLanguages: vi.fn(() => null),
    FMSystemLanguageModelSupportsLocale: vi.fn(() => true),
    FMSystemLanguageModelGetTokenCount: vi.fn(() => 10),
    FMLanguageModelSessionPrewarm: vi.fn(),

    // Memory
    FMRelease: vi.fn(),
    FMFreeString: vi.fn(),
  };
}
