<template>
  <div class="site-footer">
    <p>
      Released under the
      <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank">Apache 2.0 License</a>
    </p>
    <p>
      Built by <a href="https://github.com/codybrom" target="_blank">Cody Bromley</a> • Not
      affiliated with Apple Inc.
    </p>
  </div>
</template>

<style scoped>
.site-footer {
  border-top: 1px solid var(--vp-c-divider);
  padding: 24px 0;
  margin-top: 2rem;
  text-align: center;
}

.site-footer p {
  line-height: 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-3);
  margin: 0;
}

.site-footer a {
  color: var(--vp-c-text-2);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--vp-c-divider);
  transition:
    color 0.2s ease,
    text-decoration-color 0.2s ease;
}

.site-footer a:hover {
  color: var(--vp-c-brand-1);
  text-decoration-color: var(--vp-c-brand-1);
}
</style>
