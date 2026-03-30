import { execSync } from "node:child_process";

/** Copy text to the system clipboard using platform-native tools.
 *  Linux: xclip via DISPLAY (works over SSH with Xvfb).
 *  macOS: pbcopy. */
export function copyToClipboard(text: string) {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    } else {
      const display = process.env.DISPLAY || ":0";
      execSync(`xclip -selection clipboard`, {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...process.env, DISPLAY: display },
      });
    }
  } catch {
    // Silently fail — clipboard may not be available in all environments
  }
}
