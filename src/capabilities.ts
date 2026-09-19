/** What a model can do. */
export type ModelCapability = "vision" | "toolCalling" | "guidedGeneration" | "reasoning";

const KNOWN = new Set<string>(["vision", "toolCalling", "guidedGeneration", "reasoning"]);

/** @internal Parses the bridge's capabilities JSON; unknown names are dropped. */
export function parseCapabilities(json: string | null): ModelCapability[] {
  if (!json) return [];
  try {
    const names = JSON.parse(json) as unknown;
    return Array.isArray(names)
      ? names.filter((n): n is ModelCapability => typeof n === "string" && KNOWN.has(n))
      : [];
  } catch {
    return [];
  }
}
