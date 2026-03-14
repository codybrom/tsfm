<template>
  <div class="copy-page-wrapper">
    <div class="copy-page-group" ref="group">
      <button class="copy-page-main" @click="copyPage">
        <CheckIcon v-if="copied" class="copy-page-icon" />
        <CopyIcon v-else class="copy-page-icon" />
        <span>{{ copied ? "Copied!" : "Copy page" }}</span>
      </button>
      <button
        class="copy-page-toggle"
        @click.stop="open = !open"
        :aria-expanded="open"
        aria-label="More options"
      >
        <ChevronDownIcon class="copy-page-chevron" :class="{ flipped: open }" />
      </button>
      <div v-if="open" class="copy-page-menu">
        <button class="copy-page-item" @click="copyPage">
          <CopyIcon class="copy-page-item-icon" />
          <div>
            <div class="copy-page-item-label">Copy page</div>
            <div class="copy-page-item-desc">Copy page as Markdown for LLMs</div>
          </div>
        </button>
        <a
          :href="rawUrl"
          target="_blank"
          rel="noopener"
          class="copy-page-item"
          @click="open = false"
        >
          <MarkdownIcon class="copy-page-item-icon" />
          <div>
            <div class="copy-page-item-label">
              View as Markdown <span class="arrow">&#8599;</span>
            </div>
            <div class="copy-page-item-desc">View this page as plain text</div>
          </div>
        </a>
        <a
          :href="claudeUrl"
          target="_blank"
          rel="noopener"
          class="copy-page-item"
          @click="open = false"
        >
          <ClaudeIcon class="copy-page-item-icon" />
          <div>
            <div class="copy-page-item-label">
              Open in Claude <span class="arrow">&#8599;</span>
            </div>
            <div class="copy-page-item-desc">Ask questions about this page</div>
          </div>
        </a>
        <a
          :href="chatgptUrl"
          target="_blank"
          rel="noopener"
          class="copy-page-item"
          @click="open = false"
        >
          <OpenAiIcon class="copy-page-item-icon" />
          <div>
            <div class="copy-page-item-label">
              Open in ChatGPT <span class="arrow">&#8599;</span>
            </div>
            <div class="copy-page-item-desc">Ask questions about this page</div>
          </div>
        </a>
        <a
          :href="githubUrl"
          target="_blank"
          rel="noopener"
          class="copy-page-item"
          @click="open = false"
        >
          <GitHubIcon class="copy-page-item-icon" />
          <div>
            <div class="copy-page-item-label">
              View on GitHub <span class="arrow">&#8599;</span>
            </div>
            <div class="copy-page-item-desc">View source on GitHub</div>
          </div>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useData } from "vitepress";
import CopyIcon from "./icons/copy.svg?component";
import CheckIcon from "./icons/check.svg?component";
import ChevronDownIcon from "./icons/chevron-down.svg?component";
import MarkdownIcon from "./icons/markdown.svg?component";
import ClaudeIcon from "./icons/claude.svg?component";
import OpenAiIcon from "./icons/openai.svg?component";
import GitHubIcon from "./icons/github.svg?component";

const { page } = useData();
const open = ref(false);
const copied = ref(false);
const group = ref<HTMLElement>();

const rawUrl = computed(
  () =>
    `https://raw.githubusercontent.com/codybrom/tsfm/refs/heads/main/docs/${page.value.relativePath}`,
);

const pageUrl = computed(() => {
  const path = page.value.relativePath.replace(/\.md$/, "").replace(/\/index$/, "/");
  return `https://tsfm.dev/${path}`;
});

const claudeUrl = computed(() => {
  const q = `I have a question about this tsfm documentation page:\n\n${pageUrl.value}`;
  return `https://claude.ai/new?q=${encodeURIComponent(q)}`;
});

const chatgptUrl = computed(() => {
  const q = `I have a question about this tsfm documentation page:\n\n${pageUrl.value}`;
  return `https://chatgpt.com/?q=${encodeURIComponent(q)}`;
});

const githubUrl = computed(
  () => `https://github.com/codybrom/tsfm/blob/main/docs/${page.value.relativePath}`,
);

async function copyPage() {
  try {
    const res = await fetch(rawUrl.value);
    let text = await res.text();
    text = text.replace(/^---[\s\S]*?---\n*/, "");
    await navigator.clipboard.writeText(text.trim());
  } catch {
    const content = document.querySelector(".vp-doc")?.textContent ?? "";
    await navigator.clipboard.writeText(content.trim());
  }
  copied.value = true;
  open.value = false;
  setTimeout(() => (copied.value = false), 2000);
}

function onClickOutside(e: MouseEvent) {
  if (group.value && !group.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("click", onClickOutside));
onUnmounted(() => document.removeEventListener("click", onClickOutside));
</script>

<style scoped>
.copy-page-wrapper {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 0 0;
}

.copy-page-group {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.copy-page-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-base);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.copy-page-main:hover {
  color: var(--vp-c-text-1);
}

.copy-page-icon {
  width: 14px;
  height: 14px;
}

.copy-page-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  border: none;
  border-left: 1px solid var(--vp-c-divider);
  background: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s ease;
}

.copy-page-toggle:hover {
  color: var(--vp-c-text-1);
}

.copy-page-chevron {
  width: 12px;
  height: 12px;
  transition: transform 0.2s ease;
}

.copy-page-chevron.flipped {
  transform: rotate(180deg);
}

.copy-page-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 280px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.08),
    0 1px 4px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  z-index: 100;
}

.dark .copy-page-menu {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.3),
    0 1px 4px rgba(0, 0, 0, 0.2);
}

.copy-page-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  color: var(--vp-c-text-1);
  text-decoration: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--vp-font-family-base);
  transition: background-color 0.15s ease;
}

.copy-page-item:hover {
  background: var(--vp-c-bg-mute);
}

.copy-page-item + .copy-page-item {
  border-top: 1px solid var(--vp-c-divider);
}

.copy-page-item-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  color: var(--vp-c-text-2);
}

.copy-page-item-label {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.copy-page-item-desc {
  font-size: 12px;
  color: var(--vp-c-text-2);
  line-height: 1.3;
  margin-top: 1px;
}

.arrow {
  font-size: 11px;
  opacity: 0.6;
}
</style>
