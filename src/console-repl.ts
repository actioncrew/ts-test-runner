// ─── Constants ──────────────────────────────────────────────
const MAX_WIDTH = 63;

// Matches all ESC-based ANSI / OSC control sequences
const ANSI_FULL_REGEX =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

// Returns *visible* column width (ignoring control sequences)
export function visibleWidth(text: string): number {
  const clean = text.replace(ANSI_FULL_REGEX, "");
  return [...clean].length; // Unicode-safe
}

// Wraps text into lines that fit the given width, preserving ANSI and indentation
export function wrapLine(text: string, width: number, indentation: number = 0): string[] {
  const indent = "  ".repeat(indentation); // 2 spaces per level
  const indentWidth = indent.length;

  // Sanity check: avoid zero-width rendering
  if (width <= indentWidth) width = indentWidth + 1;

  const lines: string[] = [];
  let buffer = "";
  let visible = 0;

  // Split text into ANSI-safe tokens (keeps escape sequences intact)
  const tokens = text.split(
    /(\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)))/g
  );

  for (const token of tokens) {
    // Preserve ANSI escape sequences without affecting visible width
    if (ANSI_FULL_REGEX.test(token)) {
      buffer += token;
      continue;
    }

    for (const ch of [...token]) {
      if (visible + 1 >= width - indentWidth) {
        // Push full line with indentation applied
        lines.push(indent + buffer);
        buffer = "";
        visible = 0;
      }
      buffer += ch;
      visible += 1;
    }
  }

  if (buffer.length > 0) lines.push(indent + buffer);
  return lines;
}

// ─── ANSI colors ────────────────────────────────────────────
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

type Align = "left" | "center" | "right";

interface ReformatOptions {
  width: number;
  align?: Align;
  padChar?: string;
  trim?: boolean;
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

  visibleWidth(str: string): number {
    return [...str.replace(ANSI_FULL_REGEX, "")].length;
  }

  reformat(text: string, opts: ReformatOptions): string[] {
    const { width, align = "left", padChar = " ", trim = false } = opts;

    // Normalize: merge newlines and collapse excessive spaces
    const normalized = text
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const stripped = normalized.replace(ANSI_FULL_REGEX, "");
    const chars = [...stripped]; // Unicode-safe
    const lines = [];

    // Split into multiple lines of at most `width` visible chars
    for (let i = 0; i < chars.length; i += width) {
      const slice = chars.slice(i, i + width).join("");
      const visible = visibleWidth(slice);
      const pad = Math.max(0, width - visible);
      let formatted;

      switch (align) {
        case "right":
          formatted = padChar.repeat(pad) + slice;
          break;
        case "center": {
          const left = Math.floor(pad / 2);
          const right = pad - left;
          formatted = padChar.repeat(left) + slice + padChar.repeat(right);
          break;
        }
        default:
          formatted = slice + padChar.repeat(pad);
      }

      lines.push(formatted);
    }

    return lines;
  }

  clearLine() {
    process.stdout.write("\r\x1b[K");
  }

  private addLine(text: string, opts: { isRaw?: boolean; hasPrompt?: boolean } = {}) {
    this.previousLines.push({
      text,
      isRaw: opts.isRaw ?? false,
      hasPrompt: opts.hasPrompt ?? this.showPrompt,
    });

    if (this.previousLines.length > 200) {
      this.previousLines = this.previousLines.slice(-100);
    }
  }

  // ─── Basic printing ───────────────────────────────────────

  print(msg: string) {
    const lines = wrapLine(this.showPrompt ? this.prompt + msg : msg, MAX_WIDTH);
    for (const [i, line] of lines.entries()) {
      this.clearLine();
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

  // ─── Raw printing (with wrapping, but no prompt) ──────────
  
  printRaw(line: string) {
    // Simply print the line as-is
    process.stdout.write(line);
    this.addLine(line, { isRaw: true });
    return true;
  }

  printlnRaw(line = "") {
    this.printRaw(line);
    process.stdout.write("\n");
    this.addLine("", { isRaw: true });
    return true;
  }

  // ─── Error output (wrapped + colored) ─────────────────────
  error(msg: string) {
    const lines = wrapLine(this.showPrompt ? this.errorPrompt + msg : msg, MAX_WIDTH);
    for (const [i, line] of lines.entries()) {
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
    console.error("[Logger] Error captured:", msg);
  },
});
