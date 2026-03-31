import {
  cleanLastNewline,
  getHighlighterOptions,
  getSharedHighlighter,
  registerCustomTheme,
  renderDiffWithHighlighter,
  type FileDiffMetadata,
  type Hunk,
} from "@pierre/diffs";
import type { DiffFile } from "../../core/types";
import type { AppTheme } from "../themes";
import shadesOfPurpleTheme from "../themes/shades-of-purple.json";

// Register the Shades of Purple VS Code theme with Pierre/Shiki so it can
// be used for syntax highlighting instead of the default pierre-dark palette.
registerCustomTheme("Shades of Purple", () => Promise.resolve(shadesOfPurpleTheme as any));

/** Map hunk theme IDs to Shiki/Pierre theme names. Themes not listed here
 *  fall back to the built-in pierre-dark / pierre-light defaults. */
const THEME_ID_TO_SHIKI: Record<string, { dark: string; light: string }> = {
  "shades-of-purple": { dark: "Shades of Purple", light: "pierre-light" },
};

const DEFAULT_PIERRE_THEME = { dark: "pierre-dark", light: "pierre-light" } as const;

/** Resolve the Pierre/Shiki theme name for the active hunk theme + appearance. */
function pierreThemeName(appearance: AppTheme["appearance"], themeId?: string) {
  const mapping = themeId ? THEME_ID_TO_SHIKI[themeId] : undefined;
  return (mapping ?? DEFAULT_PIERRE_THEME)[appearance];
}

/** Build render options for Pierre, using the correct Shiki theme. */
function pierreRenderOptions(appearance: AppTheme["appearance"], themeId?: string) {
  return {
    theme: pierreThemeName(appearance, themeId),
    tokenizeMaxLineLength: 1_000,
    lineDiffType: "word-alt" as const,
  };
}

type HighlightOptions = ReturnType<typeof getHighlighterOptions>;

const highlighterOptionsByKey = new Map<string, HighlightOptions>();
let queuedHighlightWork = Promise.resolve();

type HastNode = HastTextNode | HastElementNode;

interface HastTextNode {
  type: "text";
  value: string;
}

interface HastElementNode {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface HighlightedDiffCode {
  deletionLines: Array<HastNode | undefined>;
  additionLines: Array<HastNode | undefined>;
}

export interface RenderSpan {
  text: string;
  fg?: string;
  bg?: string;
}

export interface SplitLineCell {
  kind: "context" | "addition" | "deletion" | "empty";
  sign: string;
  lineNumber?: number;
  spans: RenderSpan[];
}

export interface StackLineCell {
  kind: "context" | "addition" | "deletion";
  sign: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  spans: RenderSpan[];
}

export type DiffRow =
  | {
      type: "collapsed" | "hunk-header";
      key: string;
      fileId: string;
      hunkIndex: number;
      text: string;
    }
  | {
      type: "split-line";
      key: string;
      fileId: string;
      hunkIndex: number;
      left: SplitLineCell;
      right: SplitLineCell;
    }
  | {
      type: "stack-line";
      key: string;
      fileId: string;
      hunkIndex: number;
      cell: StackLineCell;
    };

/** Replace tabs with fixed spaces so terminal cell widths stay predictable. */
function tabify(text: string) {
  return text.replaceAll("\t", "  ");
}

/** Parse an inline CSS style string from Pierre's highlighted HAST output. */
function parseStyleValue(styleValue: unknown) {
  const styles = new Map<string, string>();
  if (typeof styleValue !== "string") {
    return styles;
  }

  for (const segment of styleValue.split(";")) {
    const separator = segment.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key && value) {
      styles.set(key, value);
    }
  }

  return styles;
}

/** Map every Pierre default token color to the theme's syntaxColors slot it corresponds to.
 *  This allows each hunk theme to fully restyle syntax highlighting without
 *  replacing Pierre's Shiki-based highlighting engine. */
const PIERRE_TOKEN_REMAP: Record<"dark" | "light", Record<string, keyof AppTheme["syntaxColors"]>> = {
  dark: {
    "#ff678d": "keyword",    // pink.400 — keywords, control flow
    "#5ecc71": "string",     // green.400 — string literals
    "#68cdf2": "number",     // cyan.400 — numeric literals
    "#84848a": "comment",    // gray.600 — comments
    "#9d6afb": "function",   // indigo.400 — function names
    "#d568ea": "type",       // purple.400 — type names
    "#ffa359": "property",   // orange.400 — variables, properties
    "#79797f": "punctuation", // gray.700 — punctuation, operators
    "#ffd452": "number",     // yellow.400 — constants
    "#ff6762": "keyword",    // red.400 — tags (remap to keyword)
    "#61d5c0": "type",       // mint.400 — attributes (remap to type)
    "#00c5d2": "punctuation", // cyan.500 — operators
    "#fbfbfb": "default",    // gray.020 — default text
  },
  light: {
    "#fc2b73": "keyword",    // pink.500
    "#199f43": "string",     // green.600
    "#1ca1c7": "number",     // cyan.600
    "#84848a": "comment",    // gray.600
    "#7b43f8": "function",   // indigo.500
    "#c635e4": "type",       // purple.500
    "#d47628": "property",   // orange.600
    "#79797f": "punctuation", // gray.700
    "#d5a910": "number",     // yellow.600 — constants
    "#d52c36": "keyword",    // red.600 — tags
    "#16a994": "type",       // mint.600 — attributes
    "#08c0ef": "punctuation", // cyan.500 — operators
    "#0b0b0c": "default",    // gray.1020 — default text
  },
};

/** Remap Pierre's default token colors to the active theme's syntax palette. */
function normalizeHighlightedColor(color: string | undefined, theme: AppTheme) {
  if (!color) {
    return color;
  }

  const normalized = color.trim().toLowerCase();
  const slot = PIERRE_TOKEN_REMAP[theme.appearance]?.[normalized];
  if (!slot) {
    return color;
  }

  return theme.syntaxColors[slot];
}

/** Append a span while coalescing adjacent runs with identical colors. */
function mergeSpan(target: RenderSpan[], next: RenderSpan) {
  if (next.text.length === 0) {
    return;
  }

  const previous = target.at(-1);
  if (previous && previous.fg === next.fg && previous.bg === next.bg) {
    previous.text += next.text;
    return;
  }

  target.push(next);
}

/** Flatten one highlighted HAST line into terminal-friendly styled text spans. */
function flattenHighlightedLine(
  node: HastNode | undefined,
  theme: AppTheme,
  emphasisBg: string,
  fallbackText: string,
) {
  const spans: RenderSpan[] = [];
  const colorVariable = theme.appearance === "light" ? "--diffs-token-light" : "--diffs-token-dark";

  const visit = (current: HastNode | undefined, inherited: Pick<RenderSpan, "fg" | "bg">) => {
    if (!current) {
      return;
    }

    if (current.type === "text") {
      mergeSpan(spans, {
        text: tabify(current.value),
        fg: inherited.fg,
        bg: inherited.bg,
      });
      return;
    }

    const properties = current.properties ?? {};
    const styles = parseStyleValue(properties.style);
    const nextStyle: Pick<RenderSpan, "fg" | "bg"> = {
      // Newer Pierre output can emit direct `color:#...` styles instead of theme CSS variables.
      fg: normalizeHighlightedColor(
        styles.get(colorVariable) ?? styles.get("color") ?? inherited.fg,
        theme,
      ),
      // Pierre marks inline word-diff emphasis spans with a data attribute rather than a separate row kind.
      bg: Object.hasOwn(properties, "data-diff-span") ? emphasisBg : inherited.bg,
    };

    for (const child of current.children ?? []) {
      visit(child, nextStyle);
    }
  };

  visit(node, {});

  if (spans.length > 0) {
    return spans;
  }

  return fallbackText.length > 0 ? [{ text: fallbackText }] : [];
}

/** Normalize one raw diff line before rendering. */
function cleanDiffLine(line: string | undefined) {
  return tabify(cleanLastNewline(line ?? ""));
}

/** Build the normalized render model for one split-view cell. */
function makeSplitCell(
  kind: SplitLineCell["kind"],
  lineNumber: number | undefined,
  rawLine: string | undefined,
  highlightedLine: HastNode | undefined,
  theme: AppTheme,
) {
  if (kind === "empty") {
    return {
      kind,
      sign: " ",
      spans: [],
    } satisfies SplitLineCell;
  }

  const fallbackText = cleanDiffLine(rawLine);

  // Startup renders often build rows before highlighted HAST exists, so keep that plain-text path cheap.
  const spans =
    highlightedLine === undefined
      ? fallbackText.length > 0
        ? [{ text: fallbackText }]
        : []
      : flattenHighlightedLine(
          highlightedLine,
          theme,
          kind === "addition"
            ? theme.addedContentBg
            : kind === "deletion"
              ? theme.removedContentBg
              : theme.contextContentBg,
          fallbackText,
        );

  return {
    kind,
    sign: kind === "addition" ? "+" : kind === "deletion" ? "-" : " ",
    lineNumber,
    spans,
  } satisfies SplitLineCell;
}

/** Build the normalized render model for one stack-view cell. */
function makeStackCell(
  kind: StackLineCell["kind"],
  oldLineNumber: number | undefined,
  newLineNumber: number | undefined,
  rawLine: string | undefined,
  highlightedLine: HastNode | undefined,
  theme: AppTheme,
) {
  const fallbackText = cleanDiffLine(rawLine);

  // Startup renders often build rows before highlighted HAST exists, so keep that plain-text path cheap.
  const spans =
    highlightedLine === undefined
      ? fallbackText.length > 0
        ? [{ text: fallbackText }]
        : []
      : flattenHighlightedLine(
          highlightedLine,
          theme,
          kind === "addition"
            ? theme.addedContentBg
            : kind === "deletion"
              ? theme.removedContentBg
              : theme.contextContentBg,
          fallbackText,
        );

  return {
    kind,
    sign: kind === "addition" ? "+" : kind === "deletion" ? "-" : " ",
    oldLineNumber,
    newLineNumber,
    spans,
  } satisfies StackLineCell;
}

/** Format a hunk header exactly as the review stream should display it. */
function hunkHeader(hunk: Hunk) {
  const specs =
    hunk.hunkSpecs ??
    `@@ -${hunk.deletionStart},${hunk.deletionLines} +${hunk.additionStart},${hunk.additionLines} @@`;
  return hunk.hunkContext ? `${specs} ${hunk.hunkContext}` : specs;
}

/** Describe a collapsed unchanged region between visible hunks. */
function collapsedRowText(lines: number) {
  return `${lines} unchanged ${lines === 1 ? "line" : "lines"}`;
}

/** Count hidden unchanged lines after the final visible hunk when Pierre omits them. */
function trailingCollapsedLines(metadata: FileDiffMetadata) {
  const lastHunk = metadata.hunks.at(-1);
  if (!lastHunk || metadata.isPartial) {
    return 0;
  }

  const additionRemaining =
    metadata.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    metadata.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  if (additionRemaining !== deletionRemaining) {
    return 0;
  }

  return Math.max(additionRemaining, 0);
}

/** Prepare syntax highlighting for one language/appearance pair using Pierre's shared highlighter. */
async function prepareHighlighter(
  language: string | undefined,
  appearance: AppTheme["appearance"],
  themeId?: string,
) {
  const resolvedLanguage = language ?? "text";
  const themeName = pierreThemeName(appearance, themeId);
  const cacheKey = `${themeName}:${resolvedLanguage}`;
  const options =
    highlighterOptionsByKey.get(cacheKey) ??
    getHighlighterOptions(resolvedLanguage, {
      theme: themeName,
    });

  if (!highlighterOptionsByKey.has(cacheKey)) {
    highlighterOptionsByKey.set(cacheKey, options);
  }

  return getSharedHighlighter({
    ...options,
    preferredHighlighter: "shiki-wasm",
  });
}

/** Queue highlight rendering so startup work stays serialized in request order. */
function queueHighlightedDiff(run: () => HighlightedDiffCode) {
  const queued = queuedHighlightWork.then(
    () =>
      new Promise<HighlightedDiffCode>((resolve, reject) => {
        queueMicrotask(() => {
          try {
            resolve(run());
          } catch (error) {
            reject(error);
          }
        });
      }),
  );

  queuedHighlightWork = queued.then(
    () => undefined,
    () => undefined,
  );

  return queued;
}

/** Highlight a diff file and return just the rendered line trees the UI needs. */
export async function loadHighlightedDiff(
  file: DiffFile,
  appearance: AppTheme["appearance"] = "dark",
  themeId?: string,
): Promise<HighlightedDiffCode> {
  try {
    const highlighter = await prepareHighlighter(file.language, appearance, themeId);
    return queueHighlightedDiff(() => {
      const highlighted = renderDiffWithHighlighter(
        file.metadata,
        highlighter,
        pierreRenderOptions(appearance, themeId),
      );
      return {
        deletionLines: highlighted.code.deletionLines as Array<HastNode | undefined>,
        additionLines: highlighted.code.additionLines as Array<HastNode | undefined>,
      };
    });
  } catch {
    const highlighter = await prepareHighlighter("text", appearance, themeId);
    return queueHighlightedDiff(() => {
      const highlighted = renderDiffWithHighlighter(
        { ...file.metadata, lang: "text" },
        highlighter,
        pierreRenderOptions(appearance, themeId),
      );
      return {
        deletionLines: highlighted.code.deletionLines as Array<HastNode | undefined>,
        additionLines: highlighted.code.additionLines as Array<HastNode | undefined>,
      };
    });
  }
}

/** Expand Pierre metadata into the flat split-view row stream consumed by the renderer. */
export function buildSplitRows(
  file: DiffFile,
  highlighted: HighlightedDiffCode | null,
  theme: AppTheme,
): DiffRow[] {
  const rows: DiffRow[] = [];
  const deletionLines = highlighted?.deletionLines ?? [];
  const additionLines = highlighted?.additionLines ?? [];

  for (const [hunkIndex, hunk] of file.metadata.hunks.entries()) {
    if (hunk.collapsedBefore > 0) {
      rows.push({
        type: "collapsed",
        key: `${file.id}:collapsed:${hunkIndex}`,
        fileId: file.id,
        hunkIndex,
        text: collapsedRowText(hunk.collapsedBefore),
      });
    }

    rows.push({
      type: "hunk-header",
      key: `${file.id}:header:${hunkIndex}`,
      fileId: file.id,
      hunkIndex,
      text: hunkHeader(hunk),
    });

    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            type: "split-line",
            key: `${file.id}:split:${hunkIndex}:context:${deletionLineIndex + offset}:${additionLineIndex + offset}`,
            fileId: file.id,
            hunkIndex,
            left: makeSplitCell(
              "context",
              deletionLineNumber + offset,
              file.metadata.deletionLines[deletionLineIndex + offset],
              deletionLines[deletionLineIndex + offset],
              theme,
            ),
            right: makeSplitCell(
              "context",
              additionLineNumber + offset,
              file.metadata.additionLines[additionLineIndex + offset],
              additionLines[additionLineIndex + offset],
              theme,
            ),
          });
        }

        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }

      // Split mode keeps deletions and additions visually paired, padding the shorter side with empty cells.
      const pairedLines = Math.max(content.deletions, content.additions);
      for (let offset = 0; offset < pairedLines; offset += 1) {
        const hasDeletion = offset < content.deletions;
        const hasAddition = offset < content.additions;

        rows.push({
          type: "split-line",
          key: `${file.id}:split:${hunkIndex}:change:${deletionLineIndex + offset}:${additionLineIndex + offset}`,
          fileId: file.id,
          hunkIndex,
          left: hasDeletion
            ? makeSplitCell(
                "deletion",
                deletionLineNumber + offset,
                file.metadata.deletionLines[deletionLineIndex + offset],
                deletionLines[deletionLineIndex + offset],
                theme,
              )
            : makeSplitCell("empty", undefined, undefined, undefined, theme),
          right: hasAddition
            ? makeSplitCell(
                "addition",
                additionLineNumber + offset,
                file.metadata.additionLines[additionLineIndex + offset],
                additionLines[additionLineIndex + offset],
                theme,
              )
            : makeSplitCell("empty", undefined, undefined, undefined, theme),
        });
      }

      deletionLineIndex += content.deletions;
      additionLineIndex += content.additions;
      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }
  }

  const trailingLines = trailingCollapsedLines(file.metadata);
  if (trailingLines > 0) {
    rows.push({
      type: "collapsed",
      key: `${file.id}:collapsed:trailing`,
      fileId: file.id,
      hunkIndex: Math.max(file.metadata.hunks.length - 1, 0),
      text: collapsedRowText(trailingLines),
    });
  }

  return rows;
}

/** Expand Pierre metadata into the flat stack-view row stream consumed by the renderer. */
export function buildStackRows(
  file: DiffFile,
  highlighted: HighlightedDiffCode | null,
  theme: AppTheme,
): DiffRow[] {
  const rows: DiffRow[] = [];
  const deletionLines = highlighted?.deletionLines ?? [];
  const additionLines = highlighted?.additionLines ?? [];

  for (const [hunkIndex, hunk] of file.metadata.hunks.entries()) {
    if (hunk.collapsedBefore > 0) {
      rows.push({
        type: "collapsed",
        key: `${file.id}:stack:collapsed:${hunkIndex}`,
        fileId: file.id,
        hunkIndex,
        text: collapsedRowText(hunk.collapsedBefore),
      });
    }

    rows.push({
      type: "hunk-header",
      key: `${file.id}:stack:header:${hunkIndex}`,
      fileId: file.id,
      hunkIndex,
      text: hunkHeader(hunk),
    });

    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            type: "stack-line",
            key: `${file.id}:stack:${hunkIndex}:context:${deletionLineIndex + offset}:${additionLineIndex + offset}`,
            fileId: file.id,
            hunkIndex,
            cell: makeStackCell(
              "context",
              deletionLineNumber + offset,
              additionLineNumber + offset,
              file.metadata.additionLines[additionLineIndex + offset],
              additionLines[additionLineIndex + offset],
              theme,
            ),
          });
        }

        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }

      for (let offset = 0; offset < content.deletions; offset += 1) {
        rows.push({
          type: "stack-line",
          key: `${file.id}:stack:${hunkIndex}:deletion:${deletionLineIndex + offset}`,
          fileId: file.id,
          hunkIndex,
          cell: makeStackCell(
            "deletion",
            deletionLineNumber + offset,
            undefined,
            file.metadata.deletionLines[deletionLineIndex + offset],
            deletionLines[deletionLineIndex + offset],
            theme,
          ),
        });
      }

      for (let offset = 0; offset < content.additions; offset += 1) {
        rows.push({
          type: "stack-line",
          key: `${file.id}:stack:${hunkIndex}:addition:${additionLineIndex + offset}`,
          fileId: file.id,
          hunkIndex,
          cell: makeStackCell(
            "addition",
            undefined,
            additionLineNumber + offset,
            file.metadata.additionLines[additionLineIndex + offset],
            additionLines[additionLineIndex + offset],
            theme,
          ),
        });
      }

      deletionLineIndex += content.deletions;
      additionLineIndex += content.additions;
      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }
  }

  const trailingLines = trailingCollapsedLines(file.metadata);
  if (trailingLines > 0) {
    rows.push({
      type: "collapsed",
      key: `${file.id}:stack:collapsed:trailing`,
      fileId: file.id,
      hunkIndex: Math.max(file.metadata.hunks.length - 1, 0),
      text: collapsedRowText(trailingLines),
    });
  }

  return rows;
}
