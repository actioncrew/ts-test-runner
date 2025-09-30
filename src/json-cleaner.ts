#!/usr/bin/env node
/**
 * Robust JSON Cleaner
 * Strips comments, trailing commas, and fixes common JSON issues
 * TypeScript implementation
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JSONCleanerOptions {
  removeComments?: boolean;
  removeTrailingCommas?: boolean;
  normalizeWhitespace?: boolean;
  allowSingleQuotes?: boolean;
  preserveNewlines?: boolean;
  strict?: boolean;
}

interface ParseState {
  inString: boolean;
  stringChar: string | null;
  escapeNext: boolean;
}

export class JSONCleaner {
  private options: Required<JSONCleanerOptions>;

  constructor(options: JSONCleanerOptions = {}) {
    this.options = {
      removeComments: options.removeComments !== false,
      removeTrailingCommas: options.removeTrailingCommas !== false,
      normalizeWhitespace: options.normalizeWhitespace === true,
      allowSingleQuotes: options.allowSingleQuotes === true,
      preserveNewlines: options.preserveNewlines !== false,
      strict: options.strict === true
    };
  }

  /**
   * Clean JSON string by removing comments and fixing common issues
   */
  public clean(jsonString: string): string {
    if (typeof jsonString !== 'string') {
      throw new Error('Input must be a string');
    }

    let result = jsonString;

    // Step 1: Remove comments
    if (this.options.removeComments) {
      result = this.stripComments(result);
    }

    // Step 2: Remove trailing commas
    if (this.options.removeTrailingCommas) {
      result = this.removeTrailingCommas(result);
    }

    // Step 3: Convert single quotes to double quotes
    if (this.options.allowSingleQuotes) {
      result = this.normalizeSingleQuotes(result);
    }

    // Step 4: Normalize whitespace
    if (this.options.normalizeWhitespace) {
      result = this.normalizeWhitespace(result);
    }

    // Step 5: Validate if strict mode
    if (this.options.strict) {
      try {
        JSON.parse(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON after cleaning: ${message}`);
      }
    }

    return result;
  }

  /**
   * Strip single-line and multi-line comments
   * More robust than simple regex - handles edge cases
   */
  private stripComments(str: string): string {
    let result = '';
    let i = 0;
    const state: ParseState = {
      inString: false,
      stringChar: null,
      escapeNext: false
    };

    while (i < str.length) {
      const char = str[i];
      const nextChar = str[i + 1];

      // Handle escape sequences
      if (state.escapeNext) {
        result += char;
        state.escapeNext = false;
        i++;
        continue;
      }

      if (char === '\\' && state.inString) {
        result += char;
        state.escapeNext = true;
        i++;
        continue;
      }

      // Track string boundaries
      if ((char === '"' || char === "'") && !state.escapeNext) {
        if (!state.inString) {
          state.inString = true;
          state.stringChar = char;
          result += char;
        } else if (char === state.stringChar) {
          state.inString = false;
          state.stringChar = null;
          result += char;
        } else {
          result += char;
        }
        i++;
        continue;
      }

      // Skip comments only if not in string
      if (!state.inString) {
        // Single-line comment
        if (char === '/' && nextChar === '/') {
          i += 2;
          // Skip until end of line
          while (i < str.length && str[i] !== '\n' && str[i] !== '\r') {
            i++;
          }
          // Preserve the newline
          if (i < str.length && this.options.preserveNewlines) {
            result += str[i];
          }
          i++;
          continue;
        }

        // Multi-line comment
        if (char === '/' && nextChar === '*') {
          i += 2;
          let foundEnd = false;
          let newlineCount = 0;

          // Skip until end of comment
          while (i < str.length - 1) {
            if (str[i] === '\n') newlineCount++;

            if (str[i] === '*' && str[i + 1] === '/') {
              i += 2;
              foundEnd = true;
              break;
            }
            i++;
          }

          if (!foundEnd) {
            throw new Error('Unclosed multi-line comment');
          }

          // Preserve newlines within the comment area
          if (this.options.preserveNewlines && newlineCount > 0) {
            result += '\n'.repeat(Math.min(newlineCount, 2));
          }
          continue;
        }
      }

      // Regular character
      result += char;
      i++;
    }

    // Check for unclosed strings
    if (state.inString) {
      throw new Error('Unclosed string in JSON');
    }

    return result;
  }

  /**
   * Remove trailing commas before closing brackets/braces
   */
  private removeTrailingCommas(str: string): string {
    let result = '';
    let i = 0;
    const state: ParseState = {
      inString: false,
      stringChar: null,
      escapeNext: false
    };

    while (i < str.length) {
      const char = str[i];

      // Handle escape sequences
      if (state.escapeNext) {
        result += char;
        state.escapeNext = false;
        i++;
        continue;
      }

      if (char === '\\' && state.inString) {
        result += char;
        state.escapeNext = true;
        i++;
        continue;
      }

      // Track string boundaries
      if ((char === '"' || char === "'") && !state.escapeNext) {
        if (!state.inString) {
          state.inString = true;
          state.stringChar = char;
        } else if (char === state.stringChar) {
          state.inString = false;
          state.stringChar = null;
        }
        result += char;
        i++;
        continue;
      }

      // Remove trailing commas only outside strings
      if (!state.inString && char === ',') {
        // Look ahead to find the next non-whitespace character
        let j = i + 1;
        while (j < str.length && /\s/.test(str[j])) {
          j++;
        }

        // If next non-whitespace is ] or }, skip the comma
        if (j < str.length && (str[j] === ']' || str[j] === '}')) {
          // Skip the comma but preserve whitespace
          i++;
          continue;
        }
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Convert single quotes to double quotes (outside of strings)
   */
  private normalizeSingleQuotes(str: string): string {
    let result = '';
    let i = 0;
    const state: ParseState = {
      inString: false,
      stringChar: null,
      escapeNext: false
    };

    while (i < str.length) {
      const char = str[i];

      if (state.escapeNext) {
        result += char;
        state.escapeNext = false;
        i++;
        continue;
      }

      if (char === '\\' && state.inString) {
        result += char;
        state.escapeNext = true;
        i++;
        continue;
      }

      if ((char === '"' || char === "'") && !state.escapeNext) {
        if (!state.inString) {
          state.inString = true;
          state.stringChar = char;
          result += '"'; // Always use double quotes
        } else if (char === state.stringChar) {
          state.inString = false;
          state.stringChar = null;
          result += '"'; // Always use double quotes
        } else {
          // Quote of different type inside string
          if (char === '"') {
            result += '\\"'; // Escape double quotes inside single-quoted string
          } else {
            result += char;
          }
        }
        i++;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  /**
   * Normalize whitespace
   */
  private normalizeWhitespace(str: string): string {
    // Remove leading/trailing whitespace from each line
    return str.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Parse JSON string with automatic cleaning
   */
  public parse<T = any>(jsonString: string): T {
    const cleaned = this.clean(jsonString);
    return JSON.parse(cleaned) as T;
  }

  /**
   * Read and clean JSON file
   */
  public readFile(filePath: string, encoding: BufferEncoding = 'utf8'): string {
    const content = fs.readFileSync(filePath, encoding);
    return this.clean(content);
  }

  /**
   * Read, clean, and parse JSON file
   */
  public parseFile<T = any>(filePath: string, encoding: BufferEncoding = 'utf8'): T {
    const cleaned = this.readFile(filePath, encoding);
    return JSON.parse(cleaned) as T;
  }

  /**
   * Clean and write JSON file
   */
  public writeFile(filePath: string, jsonString: string, encoding: BufferEncoding = 'utf8'): void {
    const cleaned = this.clean(jsonString);
    fs.writeFileSync(filePath, cleaned, encoding);
  }

  /**
   * Clean and prettify JSON file
   */
  public prettifyFile(inputPath: string, outputPath: string | null = null, indent: number = 2): void {
    const parsed = this.parseFile(inputPath);
    const prettified = JSON.stringify(parsed, null, indent);
    const targetPath = outputPath || inputPath;
    fs.writeFileSync(targetPath, prettified, 'utf8');
  }
}

// CLI Interface
interface CLIOptions extends JSONCleanerOptions {
  prettify?: boolean;
  indent?: number;
}

function parseArgs(args: string[]): { files: string[]; options: CLIOptions } {
  const options: CLIOptions = {
    removeComments: !args.includes('--no-comments'),
    removeTrailingCommas: !args.includes('--no-trailing-commas'),
    normalizeWhitespace: args.includes('--normalize-ws'),
    allowSingleQuotes: args.includes('--single-quotes'),
    strict: args.includes('--strict'),
    prettify: args.includes('--prettify'),
    indent: 2
  };

  // Parse indent value
  const indentArg = args.find(arg => arg.startsWith('--indent'));
  if (indentArg) {
    const match = indentArg.match(/--indent[=:]?(\d+)/);
    if (match && match[1]) {
      options.indent = parseInt(match[1], 10);
    }
  }

  const files = args.filter(arg => !arg.startsWith('--'));

  return { files, options };
}

// Export for use as module
export default JSONCleaner;
