
/* tsfm extensions — APIs not in Apple's python-apple-fm-sdk C bridge */

// SystemLanguageModel metadata
char *_Nullable FMSystemLanguageModelGetSupportedLanguages(FMSystemLanguageModelRef _Nonnull model);
bool FMSystemLanguageModelSupportsLocale(FMSystemLanguageModelRef _Nonnull model, const char *_Nonnull localeIdentifier);

// PrivateCloudComputeLanguageModel metadata. These are async on PCC (unlike
// SystemLanguageModel's synchronous versions), so they run on a task and report
// back through a callback, returning an FMTaskRef like the token-count family.
// supportedLanguages delivers a JSON array of minimal locale identifiers as text;
// supportsLocale reports count 1 (yes) or 0 (no).
FMTaskRef _Nonnull FMPrivateCloudComputeLanguageModelGetSupportedLanguages(void *_Nonnull model, void *_Nullable userInfo, FMLanguageModelSessionResponseCallback callback);
FMTaskRef _Nonnull FMPrivateCloudComputeLanguageModelSupportsLocale(void *_Nonnull model, const char *_Nonnull localeIdentifier, void *_Nullable userInfo, FMSystemLanguageModelTokenCountCallback callback);

// LanguageModelSession performance
void FMLanguageModelSessionPrewarm(FMLanguageModelSessionRef _Nonnull session, const char *_Nullable promptPrefix);

// LanguageModelSession token usage (cumulative); free with FMFreeString
char *_Nullable FMLanguageModelSessionGetUsageJSON(FMLanguageModelSessionRef _Nonnull session);

// Model information; free the results with FMFreeString
char *_Nullable FMSystemLanguageModelGetCapabilitiesJSON(FMSystemLanguageModelRef _Nonnull model);
char *_Nullable FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(void *_Nonnull model);
char *_Nullable FMSystemLanguageModelGetVariantName(FMSystemLanguageModelRef _Nonnull model);
