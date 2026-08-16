import { addIcon } from "obsidian";

/** Custom lightning icon id used for the ribbon and the AI search tab. */
export const ICON_LIGHTNING = "vault-search-lightning";

// Lucide-style "zap" bolt scaled to Obsidian's 0 0 100 100 icon view box
// (docs.obsidian.md/Plugins/User+interface/Icons): content only, no <svg>
// wrapper, stroke=currentColor so it follows the theme text color (white in
// dark mode, dark in light mode) instead of needing a PNG with baked-in
// colors plus a CSS invert hack. stroke-width 8 ≈ lucide's 2 on a 24 canvas.
const LIGHTNING_BOLT =
  '<polygon points="54.2 8.3 12.5 58.3 50 58.3 45.8 91.7 87.5 41.7 50 41.7 54.2 8.3" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>';

export function registerLightningIcon(): void {
  addIcon(ICON_LIGHTNING, LIGHTNING_BOLT);
}
