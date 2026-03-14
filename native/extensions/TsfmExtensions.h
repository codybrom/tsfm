
/* tsfm extensions — APIs not in Apple's python-apple-fm-sdk C bridge */

// SystemLanguageModel metadata (back-deployed to macOS 26.0+, requires Xcode 26.4+ to compile)
int FMSystemLanguageModelGetContextSize(FMSystemLanguageModelRef _Nonnull model);

// macOS 26.4+ runtime only, async — uncomment when targeting 26.4+
// int FMSystemLanguageModelGetTokenCount(FMSystemLanguageModelRef _Nonnull model, const char *_Nonnull text);

// SystemLanguageModel metadata (macOS 26.0+)
char *_Nullable FMSystemLanguageModelGetSupportedLanguages(FMSystemLanguageModelRef _Nonnull model);
bool FMSystemLanguageModelSupportsLocale(FMSystemLanguageModelRef _Nonnull model, const char *_Nonnull localeIdentifier);

// LanguageModelSession performance (macOS 26.0+)
void FMLanguageModelSessionPrewarm(FMLanguageModelSessionRef _Nonnull session, const char *_Nullable promptPrefix);
