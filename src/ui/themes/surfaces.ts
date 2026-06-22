import type { ChromeSurfaces, ThemeBase } from "./types";

/**
 * Map a theme's existing semantic palette onto the {@link ChromeSurfaces} ladder,
 * the way a VS Code theme assigns workbench colors: the editor background for
 * code, the panel color for the sidebar and file-section headers (like the active
 * tab), the dimmer panelAlt for the title/status bars, the gap band, and floating
 * widgets, and the note colors for comment boxes. Using the theme's own tokens
 * (rather than synthetic blends) means each theme keeps its intended chrome
 * direction — lighter-than-editor for github-dark, darker for Shades of Purple —
 * and authored custom themes look native. Adjacent-level distinctness is covered
 * by `surfaces.test.ts`.
 */
export function deriveSurfaces(theme: ThemeBase): ChromeSurfaces {
  return {
    code: theme.background,
    sidebar: theme.panel,
    sectionHeader: theme.panel,
    contextBand: theme.panelAlt,
    overlay: theme.panelAlt,
    note: theme.noteBackground,
    noteTitle: theme.noteTitleBackground,
    selection: theme.accentMuted,
    selectionPrimary: theme.accent,
  };
}
