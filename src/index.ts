export {
  SystemLanguageModel,
  SystemLanguageModelUseCase,
  SystemLanguageModelGuardrails,
  SystemLanguageModelUnavailableReason,
  type AvailabilityResult,
} from "./core.js";

export { LanguageModelSession } from "./session.js";
export { type PromptInput, type PromptAttachment } from "./prompt.js";

export {
  Transcript,
  type TranscriptEntry,
  type TranscriptContent,
  type TranscriptTextContent,
  type TranscriptStructuredContent,
  type TranscriptToolCall,
  type TranscriptEntryRole,
} from "./transcript.js";

export {
  GenerationSchema,
  GenerationSchemaProperty,
  GenerationGuide,
  GuideType,
  GeneratedContent,
  generable,
  type Generable,
  type PropertyDef,
  type InferSchema,
  type PropertyType,
  type NativeTypeName,
  type JsonSchema,
  type JsonObject,
} from "./schema.js";

export { SamplingMode, type SamplingModeType, type GenerationOptions } from "./options.js";

export { Tool } from "./tool.js";

export {
  FoundationModelsError,
  GenerationError,
  GenerationErrorCode,
  ExceededContextWindowSizeError,
  AssetsUnavailableError,
  GuardrailViolationError,
  UnsupportedGuideError,
  UnsupportedLanguageOrLocaleError,
  DecodingFailureError,
  RateLimitedError,
  ConcurrentRequestsError,
  RefusalError,
  InvalidGenerationSchemaError,
  InvalidArgumentError,
  TimeoutError,
  UnsupportedCapabilityError,
  UnsupportedTranscriptContentError,
  ServiceCrashedError,
  ToolCallError,
  PromptAttachmentError,
  type PromptAttachmentFailure,
} from "./errors.js";
