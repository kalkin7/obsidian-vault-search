import { addIcon } from "obsidian";

/** Custom lightning icon id used for the ribbon and the AI search tab. */
export const ICON_LIGHTNING = "vault-search-lightning";

// Lucide-style "zap" bolt: stroke=currentColor so it follows the theme text
// color (white in dark mode, dark in light mode) instead of needing a PNG
// with baked-in colors plus a CSS invert hack. Content only — Obsidian wraps
// it in a 24x24 svg.
const LIGHTNING_BOLT =
  '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export function registerLightningIcon(): void {
  addIcon(ICON_LIGHTNING, LIGHTNING_BOLT);
}
