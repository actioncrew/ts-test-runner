import * as process from 'process';

interface TeletypeConsoleOptions {
  typeSpeed?: number;
  enableColors?: boolean;
}

interface QueuedMessage {
  type: 'log' | 'warn' | 'error';
  args: any[];
}

interface OriginalConsoleMethods {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
}

// ANSI color codes
const Colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
} as const;

class TeletypeConsole {
  private queue: QueuedMessage[] = [];
  private isTyping: boolean = false;
  private typeSpeed: number;
  private enableColors: boolean;
  private original: OriginalConsoleMethods;

  constructor(options: TeletypeConsoleOptions = {}) {
    this.typeSpeed = options.typeSpeed || 20;
    this.enableColors = options.enableColors ?? true;
    
    // Store original console methods
    this.original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    };
    
    this.patch();
  }

  public patch(): void {
    console.log = (...args: any[]): void => {
      this.addToQueue('log', args);
    };
    
    console.warn = (...args: any[]): void => {
      this.addToQueue('warn', args);
    };
    
    console.error = (...args: any[]): void => {
      this.addToQueue('error', args);
    };
  }

  public unpatch(): void {
    console.log = this.original.log;
    console.warn = this.original.warn;
    console.error = this.original.error;
  }

  private addToQueue(type: 'log' | 'warn' | 'error', args: any[]): void {
    this.queue.push({ type, args });
    
    if (!this.isTyping) {
      this.processQueue();
    }
  }

  private formatArgument(arg: any): string {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }

  private getColor(type: 'log' | 'warn' | 'error'): string {
    if (!this.enableColors) return '';
    
    switch (type) {
      case 'error':
        return Colors.red;
      case 'warn':
        return Colors.yellow;
      case 'log':
      default:
        return Colors.white;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isTyping = false;
      return;
    }
    
    this.isTyping = true;
    const message = this.queue.shift();
    
    if (message) {
      await this.typeMessage(message.type, message.args);
    }
    
    // Process next message
    this.processQueue();
  }

  private async typeMessage(type: 'log' | 'warn' | 'error', args: any[]): Promise<void> {
    const color = this.getColor(type);
    const message = args.map(arg => this.formatArgument(arg)).join(' ');
    
    // Apply color if enabled
    if (this.enableColors) {
      process.stdout.write(color);
    }
    
    // Type out the message character by character
    for (const char of message) {
      process.stdout.write(char);
      await this.sleep(this.typeSpeed);
    }
    
    // Reset color and add newline
    if (this.enableColors) {
      process.stdout.write(Colors.reset);
    }
    process.stdout.write('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public setTypeSpeed(speed: number): void {
    this.typeSpeed = speed;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public async waitForQueue(): Promise<void> {
    while (this.isTyping || this.queue.length > 0) {
      await this.sleep(10);
    }
  }

  public enableColorOutput(enable: boolean): void {
    this.enableColors = enable;
  }
}

// Export for use in modules
export { TeletypeConsole };

// Example usage:
/*
import TeletypeConsole from './TeletypeConsole';

const teletype = new TeletypeConsole({ 
  typeSpeed: 5,
  enableColors: true
});

console.log('This will appear with teletype effect!');
console.warn('Warning message');
console.error('Error message');

// Wait for all messages to complete before exiting
await teletype.waitForQueue();

// To unpatch later:
teletype.unpatch();
*/