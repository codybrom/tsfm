<template>
  <div class="home-explore">
    <a
      v-for="card in cards"
      :key="card.title"
      :href="card.link"
      class="home-explore-card"
    >
      <span class="home-explore-title">{{ card.title }}</span>
      <span class="home-explore-desc">{{ card.desc }}</span>
    </a>
  </div>
</template>

<script setup lang="ts">
const cards = [
  {
    title: "Guide",
    desc: "Step-by-step walkthroughs for every feature",
    link: "/guide/getting-started",
  },
  {
    title: "API Reference",
    desc: "Full reference for every class and method",
    link: "/api/",
  },
  {
    title: "Examples",
    desc: "9 runnable examples you can copy, paste, and run",
    link: "/examples/",
  },
];
</script>
