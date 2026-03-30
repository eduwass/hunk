import { basename, extname } from "node:path/posix";

/** Nerd Font v3 file icons keyed by extension or exact filename. */
const ICON_BY_NAME: Record<string, string> = {
  // Exact filenames
  "Dockerfile":     "\uf308",
  "Makefile":       "\ue779",
  "Cargo.toml":     "\ue7a8",
  "Cargo.lock":     "\ue7a8",
  "package.json":   "\ue718",
  "tsconfig.json":  "\ue628",
  "bun.lock":       "\ue74e",
  "bun.lockb":      "\ue74e",
  ".gitignore":     "\ue702",
  ".gitmodules":    "\ue702",
  ".gitconfig":     "\ue702",
  ".env":           "\uf462",
  ".env.local":     "\uf462",
  "CLAUDE.md":      "\uf120",
  "README.md":      "\uf48a",
  "LICENSE":        "\uf0e3",
};

const ICON_BY_EXT: Record<string, string> = {
  ".ts":      "\ue628",
  ".tsx":     "\ue7ba",
  ".js":      "\ue74e",
  ".jsx":     "\ue7ba",
  ".mjs":     "\ue74e",
  ".cjs":     "\ue74e",
  ".json":    "\ue60b",
  ".toml":    "\ue60b",
  ".yaml":    "\ue60b",
  ".yml":     "\ue60b",
  ".md":      "\uf48a",
  ".mdx":     "\uf48a",
  ".rs":      "\ue7a8",
  ".go":      "\ue627",
  ".py":      "\ue73c",
  ".rb":      "\ue21e",
  ".lua":     "\ue620",
  ".sh":      "\uf489",
  ".bash":    "\uf489",
  ".zsh":     "\uf489",
  ".fish":    "\uf489",
  ".css":     "\ue749",
  ".scss":    "\ue749",
  ".html":    "\ue736",
  ".vue":     "\ue6a0",
  ".svelte":  "\ue697",
  ".astro":   "\ue697",
  ".sql":     "\ue706",
  ".graphql": "\ue662",
  ".gql":     "\ue662",
  ".xml":     "\uf121",
  ".svg":     "\uf1c5",
  ".png":     "\uf1c5",
  ".jpg":     "\uf1c5",
  ".jpeg":    "\uf1c5",
  ".gif":     "\uf1c5",
  ".ico":     "\uf1c5",
  ".webp":    "\uf1c5",
  ".wasm":    "\ue6a1",
  ".lock":    "\uf023",
  ".txt":     "\uf15c",
  ".log":     "\uf15c",
  ".csv":     "\uf1c3",
  ".conf":    "\ue615",
  ".cfg":     "\ue615",
  ".ini":     "\ue615",
  ".env":     "\uf462",
  ".docker":  "\uf308",
  ".c":       "\ue61e",
  ".cpp":     "\ue61d",
  ".h":       "\ue61e",
  ".java":    "\ue738",
  ".swift":   "\ue755",
  ".kt":      "\ue634",
  ".dart":    "\ue798",
  ".ex":      "\ue62d",
  ".exs":     "\ue62d",
  ".erl":     "\ue7b1",
  ".zig":     "\ue6a9",
  ".nix":     "\uf313",
  ".vim":     "\ue62b",
  ".tmTheme": "\ue22c",
};

const DEFAULT_ICON = "\uf15b"; //

/** Return a Nerd Font icon for the given file path. */
export function fileIcon(filePath: string): string {
  const name = basename(filePath);
  if (ICON_BY_NAME[name]) return ICON_BY_NAME[name];
  const ext = extname(name).toLowerCase();
  return ICON_BY_EXT[ext] ?? DEFAULT_ICON;
}
