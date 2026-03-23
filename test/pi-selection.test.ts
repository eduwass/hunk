import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiffFromFile } from "@pierre/diffs";
import type { Changeset, DiffFile } from "../src/core/types";
import {
  buildPiSelectionPatch,
  buildPiSelectionPayload,
  resolvePiSelectionPath,
} from "../src/ui/lib/piSelection";

function createDiffFile(id: string, path: string, before: string, after: string): DiffFile {
  const metadata = parseDiffFromFile(
    {
      name: path,
      contents: before,
      cacheKey: `${id}:before`,
    },
    {
      name: path,
      contents: after,
      cacheKey: `${id}:after`,
    },
    { context: 3 },
    true,
  );

  let additions = 0;
  let deletions = 0;
  for (const hunk of metadata.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "change") {
        additions += content.additions;
        deletions += content.deletions;
      }
    }
  }

  return {
    id,
    path,
    patch: "",
    language: "typescript",
    stats: { additions, deletions },
    metadata,
    agent: null,
  };
}

describe("pi selection bridge payloads", () => {
  test("serializes the selected hunk as a compact diff snippet and prompt", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hunk-pi-selection-"));

    try {
      const file = createDiffFile(
        "alpha",
        "alpha.ts",
        "export const alpha = 1;\n",
        "export const alpha = 2;\nexport const add = true;\n",
      );
      const changeset: Changeset = {
        id: "changeset:pi-selection",
        sourceLabel: repoRoot,
        title: "repo working tree",
        files: [file],
      };

      const patch = buildPiSelectionPatch(file, 0);
      expect(patch).toContain("@@ -1,1 +1,2 @@");
      expect(patch).toContain("-export const alpha = 1;");
      expect(patch).toContain("+export const alpha = 2;");
      expect(patch).toContain("+export const add = true;");

      const payload = buildPiSelectionPayload(changeset, file, 0);
      expect(payload).not.toBeNull();
      expect(payload?.filePath).toBe("alpha.ts");
      expect(payload?.hunkIndex).toBe(0);
      expect(payload?.oldRange).toEqual([1, 1]);
      expect(payload?.newRange).toEqual([1, 2]);
      expect(resolvePiSelectionPath(payload?.repoRoot)).toBe(
        join(repoRoot, ".hunk", "pi-selection.json"),
      );
      expect(payload?.prompt).toContain("Selected hunk from Hunk: alpha.ts");
      expect(payload?.prompt).toContain("```diff");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
