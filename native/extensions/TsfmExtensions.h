
/* tsfm extensions — APIs not in Apple's python-apple-fm-sdk C bridge */

// SystemLanguageModel metadata
char *_Nullable FMSystemLanguageModelGetSupportedLanguages(FMSystemLanguageModelRef _Nonnull model);
bool FMSystemLanguageModelSupportsLocale(FMSystemLanguageModelRef _Nonnull model, const char *_Nonnull localeIdentifier);

// LanguageModelSession performance
void FMLanguageModelSessionPrewarm(FMLanguageModelSessionRef _Nonnull session, const char *_Nullable promptPrefix);
