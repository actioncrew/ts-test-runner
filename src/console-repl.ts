import readline from 'readline';

interface LoggedLine {
  text: string;
  hasPrompt: boolean;
  isError?: boolean;
  row: number; // absolute terminal row position
}

type ParagraphType = 'default' | 'info' | 'success' | 'warning' | 'error' | 'step';

interface StyleConfig {
  prefix: string;
  color: string;
}

const colors = {
  white: '\x1b[37m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

export class Logger {
  private showPrompt = true;
  private prompt = '\x1b[1;32m> \x1b[0m ';
  private dimPrompt = '\x1b[90m> \x1b[0m ';
  private previousLines: LoggedLine[] = [];
  private currentRow = 0;

  private static styles: Record<ParagraphType, StyleConfig> = {
    default: { prefix: '›', color: colors.white },
    info: { prefix: 'ℹ', color: colors.blue + colors.bold },
    success: { prefix: '✓', color: colors.green + colors.bold },
    warning: { prefix: '⚠', color: colors.yellow + colors.bold },
    error: { prefix: '✗', color: colors.red + colors.bold },
    step: { prefix: '→', color: colors.cyan + colors.bold },
  };

  constructor() {
    this.currentRow = 0;
  }

  private writeLine(line: string, color?: string) {
    if (color) process.stdout.write(color);
    process.stdout.write(line);
    process.stdout.write('\x1b[0m'); // reset
  }

  private moveTo(row: number, col = 0) {
    readline.cursorTo(process.stdout, col, row);
  }

  private moveDown(lines = 1) {
    readline.moveCursor(process.stdout, 0, lines);
    this.currentRow += lines;
  }

  private moveUp(lines = 1) {
    readline.moveCursor(process.stdout, 0, -lines);
    this.currentRow -= lines;
  }

  print(msg: string) {
    const lines = msg.split(/\r?\n/);
    for (const line of lines) {
      const row = this.currentRow;

      process.stdout.write('\r\x1b[K');
      if (this.showPrompt) process.stdout.write(this.prompt);
      this.writeLine(line, '\x1b[1m'); // bold

      this.previousLines.push({ text: line, hasPrompt: this.showPrompt, row });
      this.showPrompt = false;
      
      if (lines.length > 1 || lines.indexOf(line) < lines.length - 1) {
        process.stdout.write('\n');
        this.currentRow++;
      }
    }
  }

  println(msg = '') {
    if (msg) this.print(msg);
    process.stdout.write('\n');
    this.currentRow++;
    this.showPrompt = true;
  }

  error(msg: string) {
    const row = this.currentRow;
    process.stdout.write('\r\x1b[K');
    if (this.showPrompt) process.stdout.write(this.prompt);
    this.writeLine(msg, '\x1b[1;31m'); // bright red
    process.stdout.write('\n');
    this.previousLines.push({ text: msg, hasPrompt: true, isError: true, row });
    this.moveDown();
    this.showPrompt = true;
  }

  // 📝 Output raw string without prompt, formatting, or logging
  raw(str: string) {
    process.stdout.write(str);
  }

  // 🔄 Repaint all previous lines in dim mode (gray or dark red)
  dimAll() {
    for (const line of this.previousLines) {
      this.moveTo(line.row, 0);
      process.stdout.write('\r\x1b[K');

      if (line.hasPrompt) process.stdout.write(this.dimPrompt);
      const color = line.isError ? '\x1b[2;31m' : '\x1b[90m'; // dark red or gray
      this.writeLine(line.text, color);
    }

    // Move back to bottom
    this.moveTo(this.currentRow, 0);
  }

  // ✏️ Update a specific line in-place by index
  updateLine(index: number, newText: string) {
    const entry = this.previousLines[index];
    if (!entry) return;

    this.moveTo(entry.row, 0);
    process.stdout.write('\r\x1b[K');

    if (entry.hasPrompt) process.stdout.write(this.prompt);
    const color = entry.isError ? '\x1b[1;31m' : '\x1b[1m';
    this.writeLine(newText, color);

    entry.text = newText;
    this.moveTo(this.currentRow, 0);
  }
}

export const logger = new Logger();