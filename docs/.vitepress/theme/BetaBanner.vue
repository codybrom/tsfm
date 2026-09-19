<script setup lang="ts">
// Shown on every page while 1.0 is in beta: the site documents 1.0, but a
// plain `npm install tsfm-sdk` still installs 0.5.
</script>

<template>
  <div class="beta-banner" role="note">
    <span class="beta-badge">Beta</span>
    <span class="long">
      These docs are for <strong>tsfm 1.0 beta</strong>: <code>npm install tsfm-sdk@beta</code>. The
      stable release is 0.5 —
      <a href="https://github.com/codybrom/tsfm/tree/v0.5.1/docs">0.5 docs</a> ·
      <a href="/guide/migrating-to-1">Migrating to 1.0</a>
    </span>
    <span class="short">
      <strong>tsfm 1.0 beta</strong> docs ·
      <a href="https://github.com/codybrom/tsfm/tree/v0.5.1/docs">0.5 docs</a>
    </span>
  </div>
</template>

<style scoped>
.beta-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--vp-z-index-layout-top);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: var(--vp-layout-top-height);
  padding: 4px 16px;
  font-size: 13px;
  line-height: 1.4;
  text-align: center;
  color: var(--vp-c-text-1);
  /* The soft tint is translucent; layer it over the page background. */
  background: linear-gradient(var(--vp-c-warning-soft), var(--vp-c-warning-soft)), var(--vp-c-bg);
  border-bottom: 1px solid var(--vp-c-divider);
}

.beta-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-white);
  background: var(--vp-c-warning-1);
}

/* One line at every width: the nav is offset by a fixed height. */
.long,
.short {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.short {
  display: none;
}

@media (max-width: 960px) {
  .long {
    display: none;
  }
  .short {
    display: inline;
  }
}

.beta-banner code {
  font-size: 12px;
}

.beta-banner a {
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}
</style>
