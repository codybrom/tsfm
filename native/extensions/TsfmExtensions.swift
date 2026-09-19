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

/// Private Cloud Compute's supported languages, delivered as a JSON array of
/// minimal locale identifiers through a response-style callback (its
/// `supportedLanguages` is async on PCC, unlike SystemLanguageModel's, so this
/// runs on a task and reports back like FMLanguageModelSessionRespond). The
/// addon treats it as a text request.
@_cdecl("FMPrivateCloudComputeLanguageModelGetSupportedLanguages")
public func FMPrivateCloudComputeLanguageModelGetSupportedLanguages(
  model: UnsafeMutableRawPointer,
  userInfo: UnsafeMutableRawPointer?,
  callback: FMLanguageModelSessionResponseCallback
) -> FMTaskRef {
  let unsafeSendableUserInfo = UnsafeSendableUserInfo(pointer: userInfo)
  guard #available(macOS 27, iOS 27, visionOS 27, *) else {
    // The pcc.ts layer short-circuits macOS 26 without calling this; the guard
    // is a backstop that reports it rather than trapping.
    let task = Task.detached {
      let message = RequiresNewerOS(feature: "Private Cloud Compute", version: "27")
        .localizedDescription
      message.withCString {
        callback(
          StatusCode.unsupportedCapability.rawValue, $0, message.utf8.count,
          unsafeSendableUserInfo.pointer)
      }
    }
    return FMTaskRef(Unmanaged.passRetained(TaskBox(task)).toOpaque())
  }
  let model = Unmanaged<PrivateCloudComputeLanguageModel>.fromOpaque(model).takeUnretainedValue()
  let task = Task.detached {
    do {
      try Task.checkCancellation()
      let languages = try await model.supportedLanguages.map { $0.minimalIdentifier }
      try Task.checkCancellation()
      let json = String(
        decoding: try JSONSerialization.data(withJSONObject: languages), as: UTF8.self)
      json.withCString {
        callback(
          StatusCode.success.rawValue, $0, json.utf8.count, unsafeSendableUserInfo.pointer)
      }
    } catch is CancellationError {
      let message = "Operation cancelled"
      message.withCString {
        callback(
          StatusCode.cancelled.rawValue, $0, message.utf8.count, unsafeSendableUserInfo.pointer)
      }
    } catch {
      let message = error.localizedDescription
      message.withCString {
        callback(statusCode(for: error), $0, message.utf8.count, unsafeSendableUserInfo.pointer)
      }
    }
  }
  return FMTaskRef(Unmanaged.passRetained(TaskBox(task)).toOpaque())
}

/// Whether Private Cloud Compute supports a locale, delivered through the
/// token-count callback: count 1 for yes, 0 for no (PCC's supportsLocale is
/// async, so it can't be a plain synchronous C function). The addon treats it
/// as a count request.
@_cdecl("FMPrivateCloudComputeLanguageModelSupportsLocale")
public func FMPrivateCloudComputeLanguageModelSupportsLocale(
  model: UnsafeMutableRawPointer,
  localeIdentifier: UnsafePointer<CChar>,
  userInfo: UnsafeMutableRawPointer?,
  callback: FMSystemLanguageModelTokenCountCallback
) -> FMTaskRef {
  // Copy the C string on the calling thread; the caller frees it after we return.
  let identifier = String(cString: localeIdentifier)
  guard #available(macOS 27, iOS 27, visionOS 27, *) else {
    return performTokenCount(userInfo: userInfo, callback: callback) {
      throw RequiresNewerOS(feature: "Private Cloud Compute", version: "27")
    }
  }
  let model = Unmanaged<PrivateCloudComputeLanguageModel>.fromOpaque(model).takeUnretainedValue()
  return performTokenCount(userInfo: userInfo, callback: callback) {
    try await model.supportsLocale(Locale(identifier: identifier)) ? 1 : 0
  }
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
/// and after. Returns nil before macOS 27, which has no usage API, or if
/// encoding fails; free the result with FMFreeString.
@_cdecl("FMLanguageModelSessionGetUsageJSON")
public func FMLanguageModelSessionGetUsageJSON(
  session: FMLanguageModelSessionRef
) -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 27, iOS 27, visionOS 27, *) else { return nil }
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

@available(macOS 27, iOS 27, visionOS 27, *)
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

/// The on-device model's capabilities as a JSON array of names, or nil before
/// macOS 27; free with FMFreeString.
@_cdecl("FMSystemLanguageModelGetCapabilitiesJSON")
public func FMSystemLanguageModelGetCapabilitiesJSON(
  model: FMSystemLanguageModelRef
) -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 27, iOS 27, visionOS 27, *) else { return nil }
  return capabilitiesJSON(Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue().capabilities)
}

/// Private Cloud Compute's capabilities as a JSON array of names; free with FMFreeString.
@_cdecl("FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON")
public func FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(
  model: UnsafeMutableRawPointer
) -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 27, iOS 27, visionOS 27, *) else { return nil }
  return capabilitiesJSON(
    Unmanaged<PrivateCloudComputeLanguageModel>.fromOpaque(model).takeUnretainedValue().capabilities)
}

/// The on-device model's variant, e.g. "AFM 3 Core Advanced", or nil before
/// macOS 27; free with FMFreeString.
@_cdecl("FMSystemLanguageModelGetVariantName")
public func FMSystemLanguageModelGetVariantName(
  model: FMSystemLanguageModelRef
) -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 27, iOS 27, visionOS 27, *) else { return nil }
  return strdup(Unmanaged<SystemLanguageModel>.fromOpaque(model).takeUnretainedValue().variant.displayName)
}
