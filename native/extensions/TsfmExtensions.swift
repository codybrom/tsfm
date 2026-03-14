/*
  tsfm extensions to the Foundation Models C bridge.
  These functions expose Swift-only APIs not included in Apple's
  python-apple-fm-sdk C bindings.
*/

import Foundation
import FoundationModels
import FoundationModelsCDeclarations

// MARK: - SystemLanguageModel extensions (requires Xcode 26.4+ to compile)

// contextSize is @backDeployed(before: macOS 26.4) so it runs on 26.0+.
// Requires Xcode 26.4+ SDK to see the declaration.
@_cdecl("FMSystemLanguageModelGetContextSize")
public func FMSystemLanguageModelGetContextSize(
  model: FMSystemLanguageModelRef
) -> Int32 {
  let model = Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue()
  return Int32(model.contextSize)
}

// tokenCount(for:) is macOS 26.4 Beta only (no back-deployment) and requires
// async bridging (takes Instructions, returns async throws Int).
// Uncomment when targeting macOS 26.4+ runtime.

// @_cdecl("FMSystemLanguageModelGetTokenCount")
// public func FMSystemLanguageModelGetTokenCount(
//   model: FMSystemLanguageModelRef,
//   text: UnsafePointer<CChar>
// ) -> Int32 {
//   let model = Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue()
//   let string = String(cString: text)
//   return Int32(model.tokenCount(for: Instructions(string)))
// }

// MARK: - SystemLanguageModel extensions (macOS 26.0+)

@_cdecl("FMSystemLanguageModelGetSupportedLanguages")
public func FMSystemLanguageModelGetSupportedLanguages(
  model: FMSystemLanguageModelRef
) -> UnsafeMutablePointer<CChar>? {
  let model = Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue()
  let languages = model.supportedLanguages.map { $0.minimalIdentifier }
  guard let data = try? JSONSerialization.data(withJSONObject: languages),
        let json = String(data: data, encoding: .utf8)
  else {
    return nil
  }
  return json.withCString { cString in
    return UnsafeMutablePointer(strdup(cString))
  }
}

@_cdecl("FMSystemLanguageModelSupportsLocale")
public func FMSystemLanguageModelSupportsLocale(
  model: FMSystemLanguageModelRef,
  localeIdentifier: UnsafePointer<CChar>
) -> Bool {
  let model = Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue()
  let locale = Locale(identifier: String(cString: localeIdentifier))
  return model.supportsLocale(locale)
}

// MARK: - LanguageModelSession extensions

@_cdecl("FMLanguageModelSessionPrewarm")
public func FMLanguageModelSessionPrewarm(
  session: FMLanguageModelSessionRef,
  promptPrefix: UnsafePointer<CChar>?
) {
  let session = Unmanaged<LanguageModelSession>.fromOpaque(session).takeUnretainedValue()
  if let promptPrefix {
    let prefix = String(cString: promptPrefix)
    session.prewarm(promptPrefix: Prompt(prefix))
  } else {
    session.prewarm()
  }
}
