import { defineConfig } from "vitepress";
import svgLoader from "vite-svg-loader";
import { generateLlmsTxt, generateLlmTxt, generateLlmsFullTxt } from "./generate-llms";
import type { Plugin } from "vite";

function llmsTxtDevPlugin(): Plugin {
  let srcDir: string;
  return {
    name: "llms-txt-dev",
    configResolved(config) {
      // VitePress sets root to the docs source directory
      srcDir = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/llms.txt") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(generateLlmTxt());
          return;
        }
        if (req.url === "/llms-full.txt") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(await generateLlmsFullTxt(srcDir));
          return;
        }
        next();
      });
    },
  };
}

function guideSidebar() {
  return [
    {
      text: "Introduction",
      collapsed: false,
      items: [
        { text: "Getting Started", link: "/guide/getting-started" },
        { text: "Model Configuration", link: "/guide/model-configuration" },
        { text: "Chat & Responses APIs", link: "/guide/chat-api" },
      ],
    },
    {
      text: "Core Concepts",
      collapsed: false,
      items: [
        { text: "Sessions", link: "/guide/sessions" },
        { text: "Streaming", link: "/guide/streaming" },
        { text: "Structured Output", link: "/guide/structured-output" },
        { text: "Tools", link: "/guide/tools" },
        { text: "Transcripts", link: "/guide/transcripts" },
        { text: "Generation Options", link: "/guide/generation-options" },
        { text: "Error Handling", link: "/guide/error-handling" },
      ],
    },
    {
      text: "Examples",
      collapsed: true,
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
        { text: "Chat & Responses APIs", link: "/examples/chat-api" },
      ],
    },
    {
      text: "API Reference",
      link: "/api/",
    },
  ];
}

export default defineConfig({
  title: "tsfm",
  description:
    "TypeScript SDK for Apple Foundation Models framework — on-device Apple Intelligence in Node.js",

  base: "/",
  cleanUrls: true,
  sitemap: {
    hostname: "https://tsfm.dev",
  },

  vite: {
    plugins: [svgLoader(), llmsTxtDevPlugin()],
  },

  async buildEnd(siteConfig) {
    await generateLlmsTxt(siteConfig);
  },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#0e6856" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:url", content: "https://tsfm.dev" }],
    [
      "meta",
      { property: "og:title", content: "tsfm — TypeScript SDK for Apple Foundation Models" },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "TypeScript SDK for Apple Foundation Models — on-device AI inference in Node.js. No keys. No fees. It just works.",
      },
    ],
    ["meta", { property: "og:image", content: "https://tsfm.dev/og-image.png" }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      { name: "twitter:title", content: "tsfm — TypeScript SDK for Apple Foundation Models" },
    ],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "TypeScript SDK for Apple Foundation Models. On-device AI inference in Node.js. No keys. No fees. It just works.",
      },
    ],
    ["meta", { name: "twitter:image", content: "https://tsfm.dev/og-image.png" }],
  ],

  themeConfig: {
    externalLinkIcon: true,
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/api/" },
      { text: "Changelog", link: "/changelog" },
    ],

    sidebar: {
      "/guide/": guideSidebar(),
      "/examples/": guideSidebar(),
      "/api/": [
        {
          text: "API Reference",
          collapsed: false,
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
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/codybrom/tsfm" },
      { icon: "npm", link: "https://www.npmjs.com/package/tsfm-sdk" },
    ],

    search: {
      provider: "local",
    },
  },
});
