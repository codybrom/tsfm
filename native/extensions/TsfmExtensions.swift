/*
  tsfm extensions to the Foundation Models C bridge.
  These functions expose Swift-only APIs not included in Apple's
  python-apple-fm-sdk C bindings.
*/

import Foundation
import FoundationModels
import FoundationModelsCDeclarations

// MARK: - SystemLanguageModel extensions

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

/// The session's cumulative token usage as JSON:
/// {"input":{"totalTokens":N,"cachedTokens":N},"output":{"totalTokens":N,"reasoningTokens":N}}
///
/// The session total is exactly the sum of every response's usage, so callers
/// that run one request at a time get per-request usage by reading this before
/// and after. Returns nil only if encoding fails; free the result with FMFreeString.
@_cdecl("FMLanguageModelSessionGetUsageJSON")
public func FMLanguageModelSessionGetUsageJSON(
  session: FMLanguageModelSessionRef
) -> UnsafeMutablePointer<CChar>? {
  let session = Unmanaged<LanguageModelSession>.fromOpaque(session).takeUnretainedValue()
  let usage = session.usage
  let object: [String: [String: Int]] = [
    "input": [
      "totalTokens": usage.input.totalTokenCount,
      "cachedTokens": usage.input.cachedTokenCount,
    ],
    "output": [
      "totalTokens": usage.output.totalTokenCount,
      "reasoningTokens": usage.output.reasoningTokenCount,
    ],
  ]
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let json = String(data: data, encoding: .utf8)
  else {
    return nil
  }
  return json.withCString { cString in
    return UnsafeMutablePointer(strdup(cString))
  }
}

// MARK: - Model information

private func capabilitiesJSON(_ capabilities: LanguageModelCapabilities) -> UnsafeMutablePointer<CChar>? {
  let known: [(String, LanguageModelCapabilities.Capability)] = [
    ("vision", .vision),
    ("toolCalling", .toolCalling),
    ("guidedGeneration", .guidedGeneration),
    ("reasoning", .reasoning),
  ]
  let names = known.filter { capabilities.contains($0.1) }.map { $0.0 }
  guard let data = try? JSONSerialization.data(withJSONObject: names),
    let json = String(data: data, encoding: .utf8)
  else { return nil }
  return strdup(json)
}

/// The on-device model's capabilities as a JSON array of names; free with FMFreeString.
@_cdecl("FMSystemLanguageModelGetCapabilitiesJSON")
public func FMSystemLanguageModelGetCapabilitiesJSON(
  model: FMSystemLanguageModelRef
) -> UnsafeMutablePointer<CChar>? {
  capabilitiesJSON(Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue().capabilities)
}

/// Private Cloud Compute's capabilities as a JSON array of names; free with FMFreeString.
@_cdecl("FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON")
public func FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(
  model: UnsafeMutableRawPointer
) -> UnsafeMutablePointer<CChar>? {
  capabilitiesJSON(
    Unmanaged<PrivateCloudComputeLanguageModel>.fromOpaque(model).takeUnretainedValue().capabilities)
}

/// The on-device model's variant, e.g. "AFM 3 Core Advanced"; free with FMFreeString.
@_cdecl("FMSystemLanguageModelGetVariantName")
public func FMSystemLanguageModelGetVariantName(
  model: FMSystemLanguageModelRef
) -> UnsafeMutablePointer<CChar>? {
  strdup(Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue().variant.displayName)
}
