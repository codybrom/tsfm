import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SiteConfig } from "vitepress";

const BASE_URL = "https://tsfm.dev";

/** Strip YAML frontmatter (--- ... ---) from markdown content. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n*/, "");
}

/** Convert a file path like guide/getting-started.md to a URL path. */
function toUrlPath(filePath: string): string {
  return "/" + filePath.replace(/\.md$/, "").replace(/\/index$/, "/");
}

/** Sections for llm.txt with their page entries. */
interface Section {
  title: string;
  entries: { label: string; url: string; summary: string }[];
}

const sections: Section[] = [
  {
    title: "Guide",
    entries: [
      {
        label: "Getting Started",
        url: "/guide/getting-started",
        summary: "Installation, requirements, and first usage",
      },
      {
        label: "Model Configuration",
        url: "/guide/model-configuration",
        summary: "SystemLanguageModel entry point and availability checking",
      },
      {
        label: "Sessions",
        url: "/guide/sessions",
        summary: "LanguageModelSession conversation state and generation methods",
      },
      {
        label: "Streaming",
        url: "/guide/streaming",
        summary: "Token-by-token streaming via async iterators",
      },
      {
        label: "Structured Output",
        url: "/guide/structured-output",
        summary: "Constrained generation with schemas and guides",
      },
      {
        label: "Tools",
        url: "/guide/tools",
        summary: "Let the model call your functions during generation",
      },
      {
        label: "Transcripts",
        url: "/guide/transcripts",
        summary: "Save and restore session history across restarts",
      },
      {
        label: "Generation Options",
        url: "/guide/generation-options",
        summary: "Temperature, token limits, and sampling strategy",
      },
      {
        label: "Error Handling",
        url: "/guide/error-handling",
        summary: "Error hierarchy and status code mapping",
      },
      {
        label: "Chat & Responses APIs",
        url: "/guide/chat-api",
        summary: "Drop-in Chat Completions and Responses API interfaces",
      },
    ],
  },
  {
    title: "API Reference",
    entries: [
      { label: "Overview", url: "/api/", summary: "All public exports at a glance" },
      {
        label: "SystemLanguageModel",
        url: "/api/system-language-model",
        summary: "On-device model access and availability",
      },
      {
        label: "LanguageModelSession",
        url: "/api/language-model-session",
        summary: "Session class with all generation methods",
      },
      {
        label: "GenerationSchema",
        url: "/api/generation-schema",
        summary: "Builder for typed structured output schemas",
      },
      {
        label: "GenerationOptions",
        url: "/api/generation-options",
        summary: "Options controlling generation behavior",
      },
      { label: "Tool", url: "/api/tool", summary: "Abstract base class for tool definitions" },
      {
        label: "Transcript",
        url: "/api/transcript",
        summary: "Session conversation history serialization",
      },
      { label: "Errors", url: "/api/errors", summary: "Error classes and status code mapping" },
      {
        label: "Chat & Responses APIs",
        url: "/api/chat",
        summary: "Client, Stream, and ResponseStream reference",
      },
    ],
  },
  {
    title: "Examples",
    entries: [
      { label: "Overview", url: "/examples/", summary: "Index of all runnable examples" },
      { label: "Basic", url: "/examples/basic", summary: "Simple prompt and response" },
      { label: "Streaming", url: "/examples/streaming", summary: "Token-by-token streaming" },
      {
        label: "Structured Output",
        url: "/examples/structured-output",
        summary: "Typed object generation with schemas",
      },
      {
        label: "JSON Schema",
        url: "/examples/json-schema",
        summary: "Standard JSON Schema structured output",
      },
      { label: "Tools", url: "/examples/tools", summary: "Tool calling with a calculator" },
      {
        label: "Generation Options",
        url: "/examples/generation-options",
        summary: "Temperature and sampling control",
      },
      {
        label: "Transcripts",
        url: "/examples/transcript",
        summary: "Saving and restoring session history",
      },
      {
        label: "Content Tagging",
        url: "/examples/content-tagging",
        summary: "Classification with CONTENT_TAGGING use case",
      },
      {
        label: "Chat & Responses APIs",
        url: "/examples/chat-api",
        summary: "Chat Completions and Responses API examples",
      },
    ],
  },
  {
    title: "Changelog",
    entries: [
      { label: "Changelog", url: "/changelog", summary: "Release history and version notes" },
    ],
  },
];

export function generateLlmTxt(): string {
  const lines: string[] = [
    "# tsfm",
    "",
    "> TypeScript SDK for Apple Foundation Models framework — on-device Apple Intelligence inference in Node.js via FFI. macOS 26+, Apple Silicon only.",
    "",
  ];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    for (const entry of section.entries) {
      lines.push(`- [${entry.label}](${BASE_URL}${entry.url}): ${entry.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Ordered list of doc files for llms-full.txt. */
const docOrder = [
  "guide/getting-started.md",
  "guide/model-configuration.md",
  "guide/sessions.md",
  "guide/streaming.md",
  "guide/structured-output.md",
  "guide/tools.md",
  "guide/transcripts.md",
  "guide/generation-options.md",
  "guide/error-handling.md",
  "guide/chat-api.md",
  "api/index.md",
  "api/system-language-model.md",
  "api/language-model-session.md",
  "api/generation-schema.md",
  "api/generation-options.md",
  "api/tool.md",
  "api/transcript.md",
  "api/errors.md",
  "api/chat.md",
  "examples/index.md",
  "examples/basic.md",
  "examples/streaming.md",
  "examples/structured-output.md",
  "examples/json-schema.md",
  "examples/tools.md",
  "examples/generation-options.md",
  "examples/transcript.md",
  "examples/content-tagging.md",
  "examples/chat-api.md",
  "changelog.md",
];

export async function generateLlmsFullTxt(srcDir: string): Promise<string> {
  const parts: string[] = [
    "# tsfm — Complete Documentation",
    "",
    "> TypeScript SDK for Apple Foundation Models framework — on-device Apple Intelligence inference in Node.js via FFI. macOS 26+, Apple Silicon only.",
    "",
  ];

  for (const file of docOrder) {
    const filePath = resolve(srcDir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const content = stripFrontmatter(raw).trim();
      parts.push("---", `Source: ${toUrlPath(file)}`, "---", "", content, "", "");
    } catch {
      // Skip missing files silently
    }
  }

  return parts.join("\n");
}

export async function generateLlmsTxt(siteConfig: SiteConfig): Promise<void> {
  const { outDir, srcDir } = siteConfig;

  const [llmTxt, llmsFullTxt] = await Promise.all([generateLlmTxt(), generateLlmsFullTxt(srcDir)]);

  await Promise.all([
    writeFile(resolve(outDir, "llms.txt"), llmTxt),
    writeFile(resolve(outDir, "llms-full.txt"), llmsFullTxt),
  ]);

  console.log("✓ Generated llms.txt and llms-full.txt");
}
