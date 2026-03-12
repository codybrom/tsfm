import { defineConfig } from "vitepress";

export default defineConfig({
  title: "tsfm",
  description:
    "TypeScript SDK for Apple's Foundation Models framework — on-device Apple Intelligence in Node.js",

  base: "/",
  cleanUrls: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#0071e3" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "TypeScript SDK for Apple's Foundation Models — on-device AI inference in Node.js. No API keys. No servers.",
      },
    ],
  ],

  themeConfig: {
    externalLinkIcon: true,
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      { text: "Examples", link: "/examples/" },
      { text: "Changelog", link: "/changelog" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Model Configuration", link: "/guide/model-configuration" },
          ],
        },
        {
          text: "Core Concepts",
          items: [
            { text: "Sessions", link: "/guide/sessions" },
            { text: "Streaming", link: "/guide/streaming" },
            { text: "Structured Output", link: "/guide/structured-output" },
            { text: "Tools", link: "/guide/tools" },
            { text: "Transcripts", link: "/guide/transcripts" },
          ],
        },
        {
          text: "Advanced",
          items: [
            { text: "Generation Options", link: "/guide/generation-options" },
            { text: "Error Handling", link: "/guide/error-handling" },
          ],
        },
        {
          text: "Integrations",
          items: [
            {
              text: "Chat & Responses APIs",
              link: "/guide/chat-api",
            },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "SystemLanguageModel", link: "/api/system-language-model" },
            { text: "LanguageModelSession", link: "/api/language-model-session" },
            { text: "GenerationSchema", link: "/api/generation-schema" },
            { text: "GenerationOptions", link: "/api/generation-options" },
            { text: "Tool", link: "/api/tool" },
            { text: "Transcript", link: "/api/transcript" },
            { text: "Errors", link: "/api/errors" },
            { text: "Chat & Responses APIs", link: "/api/chat" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Overview", link: "/examples/" },
            { text: "Basic", link: "/examples/basic" },
            { text: "Streaming", link: "/examples/streaming" },
            { text: "Structured Output", link: "/examples/structured-output" },
            { text: "JSON Schema", link: "/examples/json-schema" },
            { text: "Tools", link: "/examples/tools" },
            { text: "Generation Options", link: "/examples/generation-options" },
            { text: "Transcripts", link: "/examples/transcript" },
            { text: "Content Tagging", link: "/examples/content-tagging" },
            {
              text: "Chat & Responses APIs",
              link: "/examples/chat-api",
            },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/codybrom/tsfm" },
      { icon: "npm", link: "https://www.npmjs.com/package/tsfm-sdk" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/codybrom/tsfm/edit/main/docs/:path",
    },

    footer: {
      message: "Released under the Apache 2.0 License.",
      copyright: "Not affiliated with Apple Inc.",
    },
  },
});
