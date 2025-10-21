
// ─── Constants ──────────────────────────────────────────────
const MAX_WIDTH = 63;

// Matches all ESC-based ANSI / OSC control sequences
const ANSI_FULL_REGEX =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

// Returns *visible* column width (ignoring control sequences)
function visibleWidth(text: string): number {
  const clean = text.replace(ANSI_FULL_REGEX, "");
  return [...clean].length; // correct for surrogate pairs (emojis, etc.)
}

// Wraps a string to the given visual width, preserving ANSI codes
function wrapLine(text: string, width: number): string[] {
  const lines: string[] = [];
  let buffer = "";
  let visible = 0;

  // Split text while preserving ANSI sequences as tokens
  const tokens = text.split(/(\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)))/);

  for (const token of tokens) {
    if (ANSI_FULL_REGEX.test(token)) {
      buffer += token; // keep full escape sequence intact
      continue;
    }

    for (const ch of [...token]) { // Unicode-safe iteration
      if (visible + 1 > width) {
        lines.push(buffer);
        buffer = "";
        visible = 0;
      }
      buffer += ch;
      visible += 1;
    }
  }

  if (buffer.length > 0) lines.push(buffer);
  return lines;
}

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  brightRed: "\x1b[91m",
  green: "\x1b[32m",
  brightGreen: "\x1b[92m",
  gray: "\x1b[90m",
};

// ─── Types ─────────────────────────────────────────────────
interface LoggedLine {
  text: string;
  isRaw?: boolean;
  hasPrompt?: boolean;
}

interface LoggerOptions {
  onError?: (msg: string) => void;
  promptColor?: string;
  errorPromptColor?: string;
}

// ─── Logger Class ──────────────────────────────────────────
export class Logger {
  private previousLines: LoggedLine[] = [];
  private showPrompt = true;
  private prompt: string;
  private errorPrompt: string;
  private onError?: (msg: string) => void;

  constructor(options: LoggerOptions = {}) {
    const promptColor = options.promptColor ?? colors.brightGreen;
    const errorPromptColor = options.errorPromptColor ?? colors.brightRed;
    this.prompt = `${promptColor}> ${colors.reset}`;
    this.errorPrompt = `${errorPromptColor}> ${colors.reset}`;
    this.onError = options.onError;
  }

  private clearLine() {
    process.stdout.write("\r\x1b[K");
  }

  private addLine(text: string, opts: { isRaw?: boolean; hasPrompt?: boolean } = {}) {
    this.previousLines.push({
      text,
      isRaw: opts.isRaw ?? false,
      hasPrompt: opts.hasPrompt ?? this.showPrompt,
    });

    // keep memory bounded
    if (this.previousLines.length > 200) {
      this.previousLines = this.previousLines.slice(-100);
    }
  }

  // ─── Basic printing ───────────────────────────────────────

  print(msg: string) {
    const lines = wrapLine(msg, MAX_WIDTH);
    for (const [i, line] of lines.entries()) {
      this.clearLine();
      if (this.showPrompt) process.stdout.write(this.prompt);
      process.stdout.write(colors.bold + line + colors.reset);
      if (i < lines.length - 1) process.stdout.write("\n");
      this.addLine(line);
    }
    this.showPrompt = false;
    return true;
  }

  println(msg = "") {
    if (msg) this.print(msg);
    process.stdout.write("\n");
    this.addLine("");
    this.showPrompt = true;
    return true;
  }

  // ─── Raw printing (no prompt / no wrapping) ────────────────

  printRaw(msg: string) {
    const lines = msg.split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      process.stdout.write(line);
      if (i < lines.length - 1) process.stdout.write("\n");
      this.addLine(line, { isRaw: true });
    }
    return true;
  }

  printlnRaw(msg = "") {
    if (msg) this.printRaw(msg);
    process.stdout.write("\n");
    this.addLine("", { isRaw: true });
    return true;
  }

  // ─── Error output ─────────────────────────────────────────

  error(msg: string) {
    const lines = wrapLine(msg, MAX_WIDTH);
    for (const [i, line] of lines.entries()) {
      process.stdout.write(this.errorPrompt);
      process.stdout.write(colors.brightRed + line + colors.reset);
      if (i < lines.length - 1) process.stdout.write("\n");
      this.addLine(line);
    }
    process.stdout.write("\n");
    this.showPrompt = true;

    if (this.onError) this.onError(msg);
    return true;
  }

  // ─── Misc ─────────────────────────────────────────────────

  clearHistory() {
    this.previousLines = [];
  }

  getHistory(): LoggedLine[] {
    return [...this.previousLines];
  }
}

// ─── Example ────────────────────────────────────────────────

export const logger = new Logger({
  onError: (msg) => {
    // Example: write to a log file or remote reporter
    console.error("[Logger] Error captured:", msg);
  },
});
