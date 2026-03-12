import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import HomeExplore from "./HomeExplore.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-features-after": () => h(HomeExplore),
    });
  },
};
