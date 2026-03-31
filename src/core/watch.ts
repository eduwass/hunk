import fs from "node:fs";
import { join } from "node:path";
import {
  buildGitDiffArgs,
  buildGitShowArgs,
  buildGitStashShowArgs,
  listGitUntrackedFiles,
  resolveGitRepoRoot,
  runGitText,
} from "./git";
import type { CliInput } from "./types";

/** Return whether the current input can be rebuilt from files or Git state without rereading stdin. */
export function canReloadInput(input: CliInput) {
  if (input.options.agentContext === "-") {
    return false;
  }

  return input.kind !== "patch" || Boolean(input.file && input.file !== "-");
}

/** Format one file stat into a stable signature fragment, or mark the path missing. */
function statSignature(path: string) {
  if (!fs.existsSync(path)) {
    return `${path}:missing`;
  }

  const stat = fs.statSync(path);
  return `${path}:${stat.size}:${stat.mtimeMs}:${stat.ino}`;
}

/** Build the cheaper watch signature for working-tree git diff inputs without rendering full untracked patches. */
function gitWorkingTreeWatchSignature(input: Extract<CliInput, { kind: "git" }>, cwd?: string) {
  const trackedPatch = runGitText({ input, args: buildGitDiffArgs(input), cwd });
  const repoRoot = resolveGitRepoRoot(input, { cwd });
  const untrackedSignatures = listGitUntrackedFiles(input, { cwd }).map(
    (filePath) => `untracked:${statSignature(join(repoRoot, filePath))}`,
  );

  return [trackedPatch, ...untrackedSignatures].join("\n---\n");
}

/** Build one exact patch signature for Git-backed review inputs. */
function gitPatchSignature(input: Extract<CliInput, { kind: "git" | "show" | "stash-show" }>, cwd?: string) {
  switch (input.kind) {
    case "git":
      return gitWorkingTreeWatchSignature(input, cwd);
    case "show":
      return runGitText({ input, args: buildGitShowArgs(input), cwd });
    case "stash-show":
      return runGitText({ input, args: buildGitStashShowArgs(input), cwd });
  }
}

/** Compute a change-detection signature for one watchable input. */
export function computeWatchSignature(input: CliInput, cwd?: string) {
  const parts: string[] = [input.kind];

  switch (input.kind) {
    case "git":
    case "show":
    case "stash-show":
      parts.push(gitPatchSignature(input));
      break;
    case "diff":
    case "difftool":
      parts.push(statSignature(input.left), statSignature(input.right));
      break;
    case "patch":
      if (!input.file || input.file === "-") {
        throw new Error("Watch mode requires a patch file path instead of stdin.");
      }
      parts.push(statSignature(input.file));
      break;
  }

  if (input.options.agentContext && input.options.agentContext !== "-") {
    parts.push(`agent:${statSignature(input.options.agentContext)}`);
  }

  return parts.join("\n---\n");
}
