import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import BetaBanner from "./BetaBanner.vue";
import CopyPageButton from "./CopyPageButton.vue";
import HeroScene from "./HeroScene.vue";
import HomeExplore from "./HomeExplore.vue";
import HomeLlmDocs from "./HomeLlmDocs.vue";
import SiteFooter from "./SiteFooter.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "layout-top": () => h(BetaBanner),
      "doc-before": () => h(CopyPageButton),
      "doc-after": () => h(SiteFooter),
      "home-hero-image": () => h(HeroScene),
      "home-features-after": () => [h(HomeExplore), h(HomeLlmDocs), h(SiteFooter)],
    });
  },
};
