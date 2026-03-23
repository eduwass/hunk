import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { hunkLineRange } from "../../core/liveComments";
import type { Changeset, DiffFile } from "../../core/types";

const PI_SELECTION_RELATIVE_PATH = ".hunk/pi-selection.json";

type DiffHunk = DiffFile["metadata"]["hunks"][number];

export interface PiSelectionPayload {
  version: 1;
  source: "hunk";
  createdAt: string;
  repoRoot?: string;
  selectionPath: string;
  changesetTitle: string;
  filePath: string;
  previousPath?: string;
  hunkIndex: number;
  oldRange: [number, number];
  newRange: [number, number];
  patch: string;
  prompt: string;
}

/** Reuse the git repo root source label when this changeset came from a repo-backed review. */
function resolveRepoRoot(changeset: Changeset) {
  if (!isAbsolute(changeset.sourceLabel) || !existsSync(changeset.sourceLabel)) {
    return undefined;
  }

  return statSync(changeset.sourceLabel).isDirectory() ? changeset.sourceLabel : undefined;
}

/** Match the visible hunk header text used by the review stream. */
function hunkHeader(hunk: DiffHunk) {
  const specs =
    hunk.hunkSpecs ??
    `@@ -${hunk.deletionStart},${hunk.deletionLines} +${hunk.additionStart},${hunk.additionLines} @@`;
  return hunk.hunkContext ? `${specs} ${hunk.hunkContext}` : specs;
}

/** Rebuild one hunk as a compact diff snippet suitable for pasting into pi. */
export function buildPiSelectionPatch(file: DiffFile, hunkIndex: number) {
  const hunk = file.metadata.hunks[hunkIndex];
  if (!hunk) {
    return null;
  }

  const lines = [hunkHeader(hunk)];
  let deletionLineIndex = hunk.deletionLineIndex;
  let additionLineIndex = hunk.additionLineIndex;

  for (const content of hunk.hunkContent) {
    if (content.type === "context") {
      for (let offset = 0; offset < content.lines; offset += 1) {
        lines.push(` ${file.metadata.additionLines[additionLineIndex + offset] ?? ""}`);
      }

      deletionLineIndex += content.lines;
      additionLineIndex += content.lines;
      continue;
    }

    for (let offset = 0; offset < content.deletions; offset += 1) {
      lines.push(`-${file.metadata.deletionLines[deletionLineIndex + offset] ?? ""}`);
    }

    for (let offset = 0; offset < content.additions; offset += 1) {
      lines.push(`+${file.metadata.additionLines[additionLineIndex + offset] ?? ""}`);
    }

    deletionLineIndex += content.deletions;
    additionLineIndex += content.additions;
  }

  return lines.join("\n");
}

/** Build the payload the pi extension watches and pastes into the editor. */
export function buildPiSelectionPayload(changeset: Changeset, file: DiffFile, hunkIndex: number) {
  const hunk = file.metadata.hunks[hunkIndex];
  const patch = buildPiSelectionPatch(file, hunkIndex);
  if (!hunk || !patch) {
    return null;
  }

  const repoRoot = resolveRepoRoot(changeset);
  const selectionPath = resolve(repoRoot ?? process.cwd(), PI_SELECTION_RELATIVE_PATH);
  const { oldRange, newRange } = hunkLineRange(hunk);
  const prompt = [
    `Selected hunk from Hunk: ${file.path}`,
    `Hunk: ${hunkIndex + 1}`,
    `Old lines: ${oldRange[0]}-${oldRange[1]}`,
    `New lines: ${newRange[0]}-${newRange[1]}`,
    "",
    "```diff",
    patch,
    "```",
    "",
  ].join("\n");

  return {
    version: 1 as const,
    source: "hunk" as const,
    createdAt: new Date().toISOString(),
    repoRoot,
    selectionPath,
    changesetTitle: changeset.title,
    filePath: file.path,
    previousPath: file.previousPath,
    hunkIndex,
    oldRange,
    newRange,
    patch,
    prompt,
  } satisfies PiSelectionPayload;
}

/** Persist the current Hunk selection where the project-local pi extension can pick it up. */
export function writePiSelectionPayload(payload: PiSelectionPayload) {
  mkdirSync(dirname(payload.selectionPath), { recursive: true });
  writeFileSync(payload.selectionPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload.selectionPath;
}
