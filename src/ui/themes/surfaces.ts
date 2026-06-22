import { blendHex, relativeLuminance } from "../lib/color";
import type { ChromeSurfaces, ThemeBase } from "./types";

/** Sentinel reused from themes.ts for pager/plain themes that paint nothing. */
const TRANSPARENT = "transparent";

/**
 * Elevation ramp amounts (foreground ink blended into the editor background).
 * Ordered low -> high so each named surface sits a perceptible step above the
 * previous one. Light surfaces darken as they elevate, so they use smaller
 * amounts to avoid muddy bands; dark surfaces lighten and need a bit more.
 */
const RAMP = {
  sidebar: { light: 0.05, dark: 0.07 },
  contextBand: { light: 0.07, dark: 0.1 },
  note: { light: 0.06, dark: 0.09 },
  noteTitle: { light: 0.12, dark: 0.16 },
  sectionHeader: { light: 0.12, dark: 0.18 },
  overlay: { light: 0.16, dark: 0.22 },
} as const;

/**
 * Derive the {@link ChromeSurfaces} elevation ladder from a theme's base
 * palette. Kept purely a function of background/ink/accent so every theme
 * (bundled, custom, or transparent) gets a consistent, guaranteed-spaced ladder
 * without per-theme hand tuning. The adjacent-spacing invariant is covered by
 * `surfaces.test.ts`.
 */
export function deriveSurfaces(theme: ThemeBase): ChromeSurfaces {
  const bg = theme.background;
  if (bg === TRANSPARENT) {
    return {
      code: TRANSPARENT,
      contextBand: TRANSPARENT,
      sectionHeader: TRANSPARENT,
      sidebar: TRANSPARENT,
      overlay: TRANSPARENT,
      note: TRANSPARENT,
      noteTitle: TRANSPARENT,
      selection: theme.accentMuted,
      selectionPrimary: theme.accent,
    };
  }

  const ink = theme.text;
  const tone = relativeLuminance(bg) > 0.45 ? "light" : "dark";
  const step = (amount: number) => blendHex(ink, bg, amount);

  return {
    code: bg,
    sidebar: step(RAMP.sidebar[tone]),
    contextBand: step(RAMP.contextBand[tone]),
    sectionHeader: step(RAMP.sectionHeader[tone]),
    overlay: step(RAMP.overlay[tone]),
    note: step(RAMP.note[tone]),
    noteTitle: step(RAMP.noteTitle[tone]),
    selection: theme.accentMuted,
    selectionPrimary: theme.accent,
  };
}
