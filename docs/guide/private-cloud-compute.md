# Private Cloud Compute

`PrivateCloudComputeLanguageModel` runs Apple's server model on Private Cloud
Compute (PCC) instead of on the device. Its context is larger than the
on-device model's (`await pccModel.contextSize()` reports it), and it can
reason before answering. Each user gets a daily request quota.

Apple runs two server models on macOS 27, AFM 3 Cloud and AFM 3 Cloud Pro.
You can't pick which one is used and the response won't say which one was used either. See
[Model variants](/guide/model-configuration#model-variants).

PCC is opt-in and needs an entitlement that most Node processes won't have, so
read [Requirements](#requirements) first.

## Requirements

PCC needs **macOS 27**. On macOS 26, `isAvailable()` reports
`REQUIRES_NEWER_OS`, `capabilities` and `quotaUsage` are `null`, and creating a
session with the model throws `UnsupportedCapabilityError` (`minimumRequiredMacOS: 27`).

It also requires the managed entitlement
`com.apple.developer.private-cloud-compute`, which Apple grants to eligible
developers (see [Accessing Private Cloud Compute](https://developer.apple.com/private-cloud-compute/)).
The entitlement belongs to the **host executable**, signed with a provisioning
profile that includes it. A library can't carry it, so:

- **Plain `node` can't use PCC.** It isn't signed with your entitlement.
- **An Electron app, or another app that embeds Node, can**, once you enable the
  capability for its App ID and sign it with a matching provisioning profile.

Without the entitlement, `isAvailable()` reports `ENTITLEMENT_MISSING`, and
requests fail with `PrivateCloudComputeEntitlementError`. (Apple's own
availability check reports PCC as available even then, but tsfm checks the
entitlement itself.)

## Usage

```ts
import {
  PrivateCloudComputeLanguageModel,
  PrivateCloudComputeUnavailableReason,
  LanguageModelSession,
} from "tsfm-sdk";

const model = new PrivateCloudComputeLanguageModel();
const { available, reason } = model.isAvailable();

if (available) {
  const session = new LanguageModelSession({ model });
  const { content } = await session.respond("Compare these three designs…", {
    options: { reasoningLevel: "moderate" },
  });
} else if (reason === PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING) {
  // Fall back to the on-device model.
}
```

Streaming, structured output, tools, transcripts and `usage` work as with the
on-device model. Regex guides may use the full syntax, including character
classes, which the on-device model doesn't support.

PCC's guardrails are not the on-device model's: they follow different policies,
which you can't configure (`SystemLanguageModelGuardrails` is on-device only),
and they are stricter. In tsfm's tests PCC rejected a benign prompt containing
"the password is PLUM-42" that the on-device model accepted. Expect
`GuardrailViolationError` on some prompts the on-device model would answer.

### Reasoning

`reasoningLevel` (`"light"`, `"moderate"` or `"deep"`) sets how much the model
reasons before answering. Deeper reasoning is slower and uses more of the context
window. Only PCC reasons. On the on-device model `reasoningLevel` fails with
`UnsupportedCapabilityError`.

### Quota

```ts
const { limitReached, approachingLimit, resetDate } = model.quotaUsage;
```

When the quota runs out, requests fail with `PrivateCloudComputeQuotaExceededError`.
Users can raise their limit with iCloud+. `resetDate` is normally `null` while
the user is well below their limit. Expect a date only as they approach it or
once they've reached it.

### Supported languages

```ts
const languages = await model.supportedLanguages(); // e.g. ["en-GB", "fr-CA", "de", "ja"]
if (await model.supportsLocale("ja-JP")) {
  // ...
}
await model.supportsLocale(); // the host's current locale
```

Note the asymmetry with the on-device model: `SystemLanguageModel.supportedLanguages`
and `supportsLocale()` are **synchronous**, but on `PrivateCloudComputeLanguageModel`
both are **asynchronous** (they return a `Promise`). Apple defined them that way (`async throws`
on PCC, plain on-device), as it did for `contextSize`. On macOS 26
they resolve to `[]` and `false`.

## With the Chat and Responses APIs

The compatibility client sends a request to PCC when its `model` is
`"PrivateCloudComputeLanguageModel"`, and maps `reasoning_effort` (or
`reasoning.effort`) to `reasoningLevel`. See
[Chat API: Private Cloud Compute](/guide/chat-api#private-cloud-compute).

## Errors

| Error | When |
| --- | --- |
| `PrivateCloudComputeEntitlementError` | The host isn't signed with the PCC entitlement |
| `PrivateCloudComputeNetworkError` | PCC couldn't be reached, and retrying on-device is reasonable |
| `PrivateCloudComputeQuotaExceededError` | The user's daily quota is used up |
| `PrivateCloudComputeUnavailableError` | PCC is temporarily unavailable |

## Testing with PCC

tsfm's PCC tests need an entitled host. `scripts/pcc-host.sh` builds one: a copy
of `node` in a minimal app bundle, signed with your development certificate and a
provisioning profile whose App ID has the PCC capability.

```bash
TSFM_PCC_PROFILE=path/to/embedded.provisionprofile npm run test:integration:pcc
```

The script reads the App ID and team from the profile, and signs with the first
"Apple Development" identity in your keychain (set `TSFM_PCC_IDENTITY` to choose
another). The tests make real PCC requests, which count toward your quota.
