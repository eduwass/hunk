/** Copy text to the system clipboard using the OSC 52 terminal escape sequence.
 *  Wraps in tmux passthrough when running inside tmux so it reaches the outer terminal. */
export function copyToClipboard(text: string) {
  const encoded = Buffer.from(text).toString("base64");
  const osc = `\x1b]52;c;${encoded}\x07`;

  if (process.env.TMUX) {
    // tmux requires DCS passthrough wrapping
    process.stdout.write(`\x1bPtmux;\x1b${osc}\x1b\\`);
  } else {
    process.stdout.write(osc);
  }
}
