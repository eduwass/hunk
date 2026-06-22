import { createTextAttributes, type TextareaRenderable } from "@opentui/core";
import { flushSync } from "@opentui/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentAnnotation, DiffFile, LayoutMode } from "../../../core/types";
import { agentNoteBoxLayout } from "../../lib/agentNoteGeometry";
import { annotationRangeLabel, reviewNoteSource } from "../../lib/agentAnnotations";
import { wrapText } from "../../lib/agentPopover";
import { isEscapeKey, isSaveDraftNoteKey } from "../../lib/keyboard";
import { sanitizeTerminalLine } from "../../../lib/terminalText";
import { fitText, measureTextWidth, padText } from "../../lib/text";
import { resolveStmlColor } from "../../lib/stml/colors";
import { layoutStmlCached, type StmlLine, type StmlSpan } from "../../lib/stml/layout";
import type { AppTheme } from "../../themes";

export function inlineNoteTitle(annotation: AgentAnnotation, noteIndex: number, noteCount: number) {
  if (annotation.source === "user-draft") {
    return "Draft note";
  }

  const source = reviewNoteSource(annotation);
  const author = sanitizeTerminalLine(annotation.author?.trim() ?? "");
  const label = source === "user" ? "Your note" : author ? `${author} note` : "Agent note";
  return noteCount > 1 ? `${label} ${noteIndex + 1}/${noteCount}` : label;
}

interface AgentInlineNoteLine {
  kind: "summary" | "rationale";
  text: string;
}

/**
 * Lay out an annotation's optional STML markup body for one content width.
 *
 * Returns null when the annotation has no markup or the markup degrades to
 * nothing, so callers fall back to the plain summary/rationale body. Both
 * measurement and rendering call this with the same width, which keeps the
 * planned row height and the mounted card height in exact lockstep.
 */
export function agentInlineNoteMarkupLines(
  annotation: AgentAnnotation,
  contentWidth: number,
): StmlLine[] | null {
  if (!annotation.markup || annotation.source === "user-draft") {
    return null;
  }

  const { lines } = layoutStmlCached(annotation.markup, contentWidth);
  return lines.length > 0 ? lines : null;
}

function draftLineCount(text: string) {
  return Math.max(1, text.split("\n").length);
}

/** Estimate the textarea's wrapped visual row count for a given content width. */
function draftVisualLineCount(text: string, width: number) {
  const usableWidth = Math.max(1, width);
  return Math.max(
    1,
    text
      .split("\n")
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / usableWidth)), 0),
  );
}

function isNewlineKey(key: { ctrl?: boolean; name?: string; sequence?: string }) {
  return (
    key.name === "return" ||
    key.name === "enter" ||
    key.name === "linefeed" ||
    key.sequence === "\r" ||
    key.sequence === "\n" ||
    (key.ctrl && key.name === "j")
  );
}

/** Wrap text while preserving author-entered line breaks in review notes. */
function wrapNoteText(text: string, width: number) {
  return text.split("\n").flatMap((line) => wrapText(sanitizeTerminalLine(line), width));
}

/** Build the plain summary/rationale body used when a note has no markup. */
function agentInlineNoteBodyLines(
  annotation: AgentAnnotation,
  contentWidth: number,
): AgentInlineNoteLine[] {
  return [
    ...wrapNoteText(annotation.summary, contentWidth).map((text) => ({
      kind: "summary" as const,
      text,
    })),
    ...(annotation.rationale
      ? wrapNoteText(annotation.rationale, contentWidth).map((text) => ({
          kind: "rationale" as const,
          text,
        }))
      : []),
  ];
}

export function measureAgentInlineNoteHeight({
  annotation,
  anchorSide,
  layout,
  width,
}: {
  annotation: AgentAnnotation;
  anchorSide?: "old" | "new";
  layout: Exclude<LayoutMode, "auto">;
  width: number;
}) {
  const { contentWidth } = agentNoteBoxLayout({ anchorSide, layout, width });

  if (annotation.source === "user-draft") {
    // Keep geometry aligned with the rendered textarea rows, including soft wraps.
    return draftVisualLineCount(annotation.summary, contentWidth) + 6;
  }

  const markupLines = agentInlineNoteMarkupLines(annotation, contentWidth);
  const bodyLineCount = markupLines
    ? markupLines.length
    : agentInlineNoteBodyLines(annotation, contentWidth).length;

  // top border + top padding row + body lines + bottom border
  return 3 + bodyLineCount;
}

/** Render the note card itself before the start of an annotated range. */
export function AgentInlineNote({
  annotation,
  anchorSide,
  file,
  layout,
  noteCount = 1,
  noteIndex = 0,
  draft,
  onClose,
  theme,
  width,
}: {
  annotation: AgentAnnotation;
  anchorSide?: "old" | "new";
  file?: DiffFile;
  layout: Exclude<LayoutMode, "auto">;
  noteCount?: number;
  noteIndex?: number;
  draft?: {
    body: string;
    focused: boolean;
    onBlur?: () => void;
    onCancel: () => void;
    onFocus?: () => void;
    onInput: (value: string) => void;
    onSave: () => void;
  };
  onClose?: () => void;
  theme: AppTheme;
  width: number;
}) {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const [draftLineCountHint, setDraftLineCountHint] = useState(() =>
    draftLineCount(draft?.body ?? ""),
  );

  useEffect(() => {
    setDraftLineCountHint(draftLineCount(draft?.body ?? ""));
  }, [draft?.body]);

  useLayoutEffect(() => {
    if (!draft) {
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const originalFocus = textarea.focus.bind(textarea);
    const originalBlur = textarea.blur.bind(textarea);
    let active = true;

    textarea.focus = () => {
      originalFocus();
      if (active) {
        draft.onFocus?.();
      }
    };

    textarea.blur = () => {
      originalBlur();
      if (active) {
        draft.onBlur?.();
      }
    };

    return () => {
      active = false;
      textarea.focus = originalFocus;
      textarea.blur = originalBlur;
    };
  }, [draft]);

  // In borderless chrome the note keeps its box-drawing rows for geometry, but the
  // glyphs are painted in the band color so no lines show — a filled note band.
  const borderless = theme.chrome === "borderless";
  const surfaceBg = borderless ? theme.surfaces.note : theme.panel;
  const borderFg = borderless ? surfaceBg : theme.noteBorder;
  const closeText = onClose ? "[x]" : "";
  const titleText = `${inlineNoteTitle(annotation, noteIndex, noteCount)} - ${annotationRangeLabel(annotation, file)}`;
  const { boxWidth, boxLeft, contentWidth } = agentNoteBoxLayout({ anchorSide, layout, width });
  const closeGapWidth = closeText ? 1 : 0;
  const closeWidth = closeText.length;
  const draftInnerWidth = Math.max(1, boxWidth - 2);
  const draftContentWidth = Math.max(1, draftInnerWidth - 2);
  const draftVisibleRows = draft
    ? Math.max(draftLineCountHint, draftVisualLineCount(draft.body, draftContentWidth))
    : 0;

  useLayoutEffect(() => {
    if (!draft || draftVisibleRows <= 0) {
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const viewport = textarea.editorView.getViewport();
    if (viewport.offsetY === 0 && viewport.height === draftVisibleRows) {
      return;
    }

    // The textarea follows the cursor after Enter while its old one-line viewport is still active.
    // Once the composer grows to fit the new line, reset the viewport so previous lines stay visible.
    textarea.editorView.setViewport(viewport.offsetX, 0, viewport.width, draftVisibleRows, false);
    textarea.requestRender();
  }, [draft, draftVisibleRows]);

  const updateDraftLineCountHint = (nextLineCount: number) => {
    flushSync(() => {
      setDraftLineCountHint(nextLineCount);
    });
  };

  const lines = agentInlineNoteBodyLines(annotation, contentWidth);
  const savedTitleText = fitText(
    ` ${titleText} `,
    Math.max(0, boxWidth - 4 - closeGapWidth - closeWidth),
  );
  const savedTopBorderSuffixWidth = Math.max(
    0,
    boxWidth - 3 - savedTitleText.length - closeGapWidth - closeWidth,
  );
  const savedTopPrefixWidth = 2 + savedTitleText.length + savedTopBorderSuffixWidth;
  const bottomBorder = `╰${"─".repeat(Math.max(0, boxWidth - 2))}╯`;

  if (draft) {
    const draftVisibleLineCount = draftVisibleRows;
    const draftTitleText = fitText(` ${titleText} `, Math.max(0, boxWidth - 4));
    const saveInnerWidth = 11;
    const cancelInnerWidth = 14;
    const footerRemainderWidth = Math.max(0, boxWidth - saveInnerWidth - cancelInnerWidth - 4);
    const draftTopBorderSuffix = `${"─".repeat(Math.max(0, boxWidth - 3 - draftTitleText.length))}╮`;
    const footerButtonWidth = 1 + saveInnerWidth + 1 + cancelInnerWidth + 1;
    const footerButtonLeft = boxLeft + footerRemainderWidth + 1;
    const draftActionBorder = `╰${"─".repeat(footerRemainderWidth)}┬${"─".repeat(saveInnerWidth)}┬${"─".repeat(cancelInnerWidth)}┤`;
    const draftButtonBottom = `╰${"─".repeat(saveInnerWidth)}┴${"─".repeat(cancelInnerWidth)}╯`;
    const draftTextareaRows = draftVisibleLineCount;
    const draftTopPaddingRows = 1;
    const draftBottomPaddingRows = 1;
    const renderDraftBodyPaddingRows = (keyPrefix: string, rowCount: number) =>
      Array.from({ length: rowCount }, (_, rowIndex) => (
        <box
          key={`${keyPrefix}:${rowIndex}`}
          style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}
        >
          <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
            <text>{" ".repeat(boxLeft)}</text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              │
            </text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }} />
          <box style={{ width: draftContentWidth, height: 1, backgroundColor: surfaceBg }}>
            <text bg={surfaceBg}>{" ".repeat(draftContentWidth)}</text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }} />
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              │
            </text>
          </box>
        </box>
      ));

    return (
      <box style={{ width: "100%", flexDirection: "column", backgroundColor: surfaceBg }}>
        <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
          <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
            <text>{" ".repeat(boxLeft)}</text>
          </box>
          <box style={{ width: boxWidth, height: 1, backgroundColor: surfaceBg }}>
            <text>
              <span fg={borderFg} bg={surfaceBg}>
                ╭─
              </span>
              <span fg={theme.noteTitleText} bg={surfaceBg}>
                {draftTitleText}
              </span>
              <span fg={borderFg} bg={surfaceBg}>
                {draftTopBorderSuffix}
              </span>
            </text>
          </box>
        </box>

        {renderDraftBodyPaddingRows("draft-body-top-padding", draftTopPaddingRows)}

        <box
          style={{
            width: "100%",
            height: draftTextareaRows,
            flexDirection: "row",
            backgroundColor: surfaceBg,
          }}
        >
          <box style={{ width: boxLeft, height: draftTextareaRows, backgroundColor: surfaceBg }} />
          <box
            style={{
              width: 1,
              height: draftTextareaRows,
              flexDirection: "column",
              backgroundColor: surfaceBg,
            }}
          >
            {Array.from({ length: draftTextareaRows }, (_, rowIndex) => (
              <text key={`draft-textarea-left-border:${rowIndex}`} fg={borderFg} bg={surfaceBg}>
                │
              </text>
            ))}
          </box>
          <box style={{ width: 1, height: draftTextareaRows, backgroundColor: surfaceBg }} />
          <textarea
            ref={textareaRef}
            width={draftContentWidth}
            height={draftTextareaRows}
            initialValue={draft.body}
            placeholder="Write a note…"
            focused={draft.focused}
            backgroundColor={surfaceBg}
            textColor={theme.text}
            focusedBackgroundColor={surfaceBg}
            focusedTextColor={theme.text}
            keyBindings={[{ name: "j", ctrl: true, action: "newline" }]}
            onContentChange={() => {
              const textarea = textareaRef.current;
              const nextBody = textarea?.plainText ?? "";
              updateDraftLineCountHint(
                Math.max(
                  draftVisualLineCount(nextBody, draftContentWidth),
                  textarea?.virtualLineCount ?? 0,
                ),
              );
              draft.onInput(nextBody);
            }}
            onKeyDown={(key) => {
              if (isNewlineKey(key)) {
                updateDraftLineCountHint(
                  draftVisualLineCount(
                    textareaRef.current?.plainText ?? draft.body,
                    draftContentWidth,
                  ) + 1,
                );
              }

              if (isSaveDraftNoteKey(key)) {
                key.preventDefault();
                key.stopPropagation();
                draft.onSave();
                return;
              }

              if (isEscapeKey(key)) {
                key.preventDefault();
                key.stopPropagation();
                draft.onCancel();
              }
            }}
          />
          <box style={{ width: 1, height: draftTextareaRows, backgroundColor: surfaceBg }} />
          <box
            style={{
              width: 1,
              height: draftTextareaRows,
              flexDirection: "column",
              backgroundColor: surfaceBg,
            }}
          >
            {Array.from({ length: draftTextareaRows }, (_, rowIndex) => (
              <text key={`draft-textarea-right-border:${rowIndex}`} fg={borderFg} bg={surfaceBg}>
                │
              </text>
            ))}
          </box>
        </box>

        {renderDraftBodyPaddingRows("draft-body-bottom-padding", draftBottomPaddingRows)}

        <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
          <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
            <text>{" ".repeat(boxLeft)}</text>
          </box>
          <box style={{ width: boxWidth, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              {draftActionBorder}
            </text>
          </box>
        </box>

        <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
          <box style={{ width: footerButtonLeft, height: 1, backgroundColor: surfaceBg }}>
            <text>{" ".repeat(footerButtonLeft)}</text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              │
            </text>
          </box>
          <box onMouseUp={draft.onSave} style={{ width: saveInnerWidth, height: 1 }}>
            <text fg={theme.noteTitleText} bg={surfaceBg}>
              {padText(" Save (^S) ", saveInnerWidth)}
            </text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              │
            </text>
          </box>
          <box onMouseUp={draft.onCancel} style={{ width: cancelInnerWidth, height: 1 }}>
            <text fg={theme.noteTitleText} bg={surfaceBg}>
              {padText(" Cancel (Esc) ", cancelInnerWidth)}
            </text>
          </box>
          <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              │
            </text>
          </box>
        </box>

        <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
          <box style={{ width: footerButtonLeft, height: 1, backgroundColor: surfaceBg }}>
            <text>{" ".repeat(footerButtonLeft)}</text>
          </box>
          <box style={{ width: footerButtonWidth, height: 1, backgroundColor: surfaceBg }}>
            <text fg={borderFg} bg={surfaceBg}>
              {draftButtonBottom}
            </text>
          </box>
        </box>
      </box>
    );
  }

  const markupLines = agentInlineNoteMarkupLines(annotation, contentWidth);

  /** Resolve one STML span into concrete OpenTUI text props for this theme. */
  const markupSpanProps = (span: StmlSpan) => ({
    fg: resolveStmlColor(span.fg, theme) ?? theme.text,
    bg: resolveStmlColor(span.bg, theme) ?? theme.panel,
    attributes: createTextAttributes({
      bold: span.bold,
      italic: span.italic,
      underline: span.underline,
      dim: span.dim,
      strikethrough: span.strike,
    }),
  });

  /** One card body row: left offset, side borders, and a one-line content cell. */
  const renderBodyRow = (key: string, content: ReactNode) => (
    <box
      key={key}
      style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}
    >
      <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
        <text>{" ".repeat(boxLeft)}</text>
      </box>
      <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
        <text fg={borderFg} bg={surfaceBg}>
          │
        </text>
      </box>
      <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }} />
      <box style={{ width: contentWidth, height: 1, backgroundColor: surfaceBg }}>{content}</box>
      <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }} />
      <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
        <text fg={borderFg} bg={surfaceBg}>
          │
        </text>
      </box>
    </box>
  );

  const renderMarkupBodyRow = (key: string, line: StmlLine) => {
    const usedWidth = line.spans.reduce((total, span) => total + measureTextWidth(span.text), 0);
    return renderBodyRow(
      key,
      <text bg={theme.panel}>
        {line.spans.map((span, spanIndex) => (
          <span key={`${key}:span:${spanIndex}`} {...markupSpanProps(span)}>
            {span.text}
          </span>
        ))}
        {usedWidth < contentWidth ? (
          <span bg={theme.panel}>{" ".repeat(contentWidth - usedWidth)}</span>
        ) : null}
      </text>,
    );
  };

  const renderSavedBodyRow = (key: string, text: string, kind: AgentInlineNoteLine["kind"]) =>
    renderBodyRow(
      key,
      <text fg={kind === "summary" ? theme.text : theme.muted} bg={theme.panel}>
        {padText(text, contentWidth)}
      </text>,
    );

  return (
    <box style={{ width: "100%", flexDirection: "column", backgroundColor: surfaceBg }}>
      <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
        <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
          <text>{" ".repeat(boxLeft)}</text>
        </box>
        <box style={{ width: savedTopPrefixWidth, height: 1, backgroundColor: surfaceBg }}>
          <text>
            <span fg={borderFg} bg={surfaceBg}>
              ╭─
            </span>
            <span fg={theme.noteTitleText} bg={surfaceBg}>
              {savedTitleText}
            </span>
            <span fg={borderFg} bg={surfaceBg}>
              {"─".repeat(savedTopBorderSuffixWidth)}
            </span>
          </text>
        </box>
        {closeText ? (
          <box style={{ width: closeGapWidth, height: 1, backgroundColor: surfaceBg }}>
            <text bg={surfaceBg}>{" ".repeat(closeGapWidth)}</text>
          </box>
        ) : null}
        {closeText ? (
          <box
            onMouseUp={onClose}
            style={{ width: closeWidth, height: 1, backgroundColor: surfaceBg }}
          >
            <text fg={theme.noteTitleText} bg={surfaceBg}>
              {closeText}
            </text>
          </box>
        ) : null}
        <box style={{ width: 1, height: 1, backgroundColor: surfaceBg }}>
          <text fg={borderFg} bg={surfaceBg}>
            ╮
          </text>
        </box>
      </box>

      {renderSavedBodyRow("saved-note-top-padding", "", "summary")}

      {markupLines
        ? markupLines.map((line, index) => renderMarkupBodyRow(`markup:${index}`, line))
        : lines.map((line, index) =>
            renderSavedBodyRow(`${line.kind}:${index}`, line.text, line.kind),
          )}

      <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: surfaceBg }}>
        <box style={{ width: boxLeft, height: 1, backgroundColor: surfaceBg }}>
          <text>{" ".repeat(boxLeft)}</text>
        </box>
        <box style={{ width: boxWidth, height: 1, backgroundColor: surfaceBg }}>
          <text fg={borderFg} bg={surfaceBg}>
            {bottomBorder}
          </text>
        </box>
      </box>
    </box>
  );
}
