import { FoundationModelsError } from "./errors.js";

/** What a model can do. */
export type ModelCapability = "vision" | "toolCalling" | "guidedGeneration" | "reasoning";

const KNOWN = new Set<string>(["vision", "toolCalling", "guidedGeneration", "reasoning"]);

/**
 * @internal Parses the bridge's capabilities JSON. null means capabilities
 * aren't available (macOS 26 doesn't report them) and is returned as null.
 * Malformed JSON throws, like supportedLanguages, instead of reading as "no
 * capabilities". Names this version doesn't know are dropped.
 */
export function parseCapabilities(json: string | null): ModelCapability[] | null {
  // null: capabilities aren't available (macOS 26 doesn't report them).
  if (json === null) return null;
  let names: unknown;
  try {
    names = JSON.parse(json);
  } catch {
    names = undefined;
  }
  if (!Array.isArray(names)) {
    throw new FoundationModelsError(
      `Failed to parse model capabilities JSON: ${json.slice(0, 200)}`,
    );
  }
  return names.filter((n): n is ModelCapability => typeof n === "string" && KNOWN.has(n));
}
