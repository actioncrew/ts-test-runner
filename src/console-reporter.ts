import util from 'util';

interface EnvironmentInfo {
  node: string;
  platform: string;
  arch: string;
  cwd: string;
  memory: string;
  pid: number;
  uptime: string;
  userAgent?: UserAgent;
}

interface UserAgent {
  userAgent: string;
  appName: string;
  appVersion: string;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
}

interface TestSpec {
  id: string;
  description: string;
  fullName: string;
  status: 'passed' | 'failed' | 'pending' | 'running';
  duration?: number;
  failedExpectations?: any[];
  pendingReason?: string;
}

interface TestSuite {
  id: string;
  description: string;
  fullName: string;
  specs: TestSpec[];
  children: TestSuite[];
  parent?: TestSuite;
}

export class ConsoleReporter {
  private print: (...args: any[]) => void;
  private showColors: boolean;
  private specCount: number;
  private executableSpecCount: number;
  private failureCount: number;
  private failedSpecs: any[];
  private pendingSpecs: any[];
  private ansi: Record<string, string>;
  private startTime: number;
  private jasmineReady: Promise<void>;
  private resolveJasmineReady: (() => void) | null;
  private envInfo: EnvironmentInfo | null;
  private testConfig: any;
  private rootSuite: TestSuite;
  private currentSuite: TestSuite | null;
  private suiteStack: TestSuite[];
  private currentSpec: TestSpec | null;
  private readonly lineWidth: number = 60;
  private interruptHandlersRegistered: boolean = false;

  constructor() {
    this.print = (...args) => process.stdout.write(util.format(...args));
    this.showColors = this.detectColorSupport();
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.startTime = 0;
    
    // Fixed: Initialize both properties correctly
    let resolveFunc: (() => void) | null = null;
    this.jasmineReady = new Promise((resolve) => {
      resolveFunc = resolve;
    });
    this.resolveJasmineReady = resolveFunc;
    
    this.envInfo = null;
    this.testConfig = null;
    this.rootSuite = this.createRootSuite();
    this.currentSuite = null;
    this.suiteStack = [this.rootSuite];
    this.currentSpec = null;
    this.ansi = { 
      green: '\x1B[32m',
      brightGreen: '\x1B[92m',
      red: '\x1B[31m',
      brightRed: '\x1B[91m',
      yellow: '\x1B[33m',
      brightYellow: '\x1B[93m',
      blue: '\x1B[34m',
      brightBlue: '\x1B[94m',
      cyan: '\x1B[36m',
      brightCyan: '\x1B[96m',
      magenta: '\x1B[35m',
      gray: '\x1B[90m',
      white: '\x1B[97m',
      bold: '\x1B[1m',
      dim: '\x1B[2m',
      none: '\x1B[0m'
    };
  }

  // Detect if terminal supports colors
  private detectColorSupport(): boolean {
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR) return true;
    return process.stdout.isTTY ?? false;
  }

  private createRootSuite(): TestSuite {
    return {
      id: 'root',
      description: 'Root Suite',
      fullName: '',
      specs: [],
      children: []
    };
  }

  userAgent(message: any) {
    this.envInfo = this.gatherEnvironmentInfo();
    const userAgent = { ...message };
    delete userAgent?.timestamp;
    delete userAgent?.type;
    this.envInfo = {
      ...this.envInfo,
      userAgent
    };

    this.resolveJasmineReady?.();
  }

  async jasmineStarted(config: any) {
    await this.jasmineReady;

    this.startTime = Date.now();
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.testConfig = config;
    this.rootSuite = this.createRootSuite();
    this.suiteStack = [this.rootSuite];
    this.currentSuite = null;
    this.currentSpec = null;
    
    this.setupInterruptHandler();
    
    this.print('\n');
    this.printBox('Test Runner Started', 'cyan');
    this.printEnvironmentInfo();
    this.printTestConfiguration(config);
    this.print('\n');
  }

  suiteStarted(config: any) {
    const suite: TestSuite = {
      id: config.id,
      description: config.description,
      fullName: config.fullName,
      specs: [],
      children: [],
      parent: this.suiteStack[this.suiteStack.length - 1]
    };
    
    this.suiteStack[this.suiteStack.length - 1].children.push(suite);
    this.suiteStack.push(suite);
    this.currentSuite = suite;
    
    if (config.description) {
      this.clearCurrentLine();
      this.printSuiteLine(suite, false);
    }
  }

  specStarted(config: any) {
    const spec: TestSpec = {
      id: config.id,
      description: config.description,
      fullName: config.fullName,
      status: 'running'
    };
    
    this.currentSpec = spec;
    
    if (this.currentSuite) {
      this.currentSuite.specs.push(spec);
    }
    
    this.updateStatusLine();
  }

  specDone(result: any) {
    this.specCount++;
    
    if (this.currentSpec) {
      this.currentSpec.status = result.status;
      this.currentSpec.duration = result.duration;
      this.currentSpec.failedExpectations = result.failedExpectations;
      this.currentSpec.pendingReason = result.pendingReason;
    }
    
    switch (result.status) {
      case 'passed': 
        this.executableSpecCount++; 
        break;
      case 'failed': 
        this.failureCount++; 
        this.failedSpecs.push(result); 
        this.executableSpecCount++; 
        break;
      case 'pending': 
        this.pendingSpecs.push(result); 
        this.executableSpecCount++; 
        break;
    }
    
    this.currentSpec = null;
    
    if (this.currentSuite) {
      this.clearCurrentLine();
      this.printSuiteLine(this.currentSuite, false);
      this.updateStatusLine();
    }
  }

  suiteDone(result: any) {
    this.clearCurrentLine();
    if (this.currentSuite) {
      this.printSuiteLine(this.currentSuite, true);
      this.print('\n');
    }
    
    this.suiteStack.pop();
    this.currentSuite = this.suiteStack.length > 0 
      ? this.suiteStack[this.suiteStack.length - 1] 
      : null;
  }

  jasmineDone(result: any) {
    const totalTime = result?.totalTime 
      ? result.totalTime / 1000 
      : (Date.now() - this.startTime) / 1000;
    
    this.print('\n\n');
    this.printDivider();

    if (this.failedSpecs.length > 0) {
      this.printFailures();
    }

    if (this.pendingSpecs.length > 0) {
      this.printPendingSpecs();
    }

    this.print('\n');
    this.printSummary(totalTime);
    
    this.print('\n');
    this.printFinalStatus(result?.overallStatus);
    
    this.print('\n\n');

    return this.failureCount;
  }

  testsAborted(message?: string) {
    this.print('\n\n');
    this.printBox(`✕ TESTS ABORTED${message ? ': ' + message : ''}`, 'red');
    this.print('\n');
    this.printTestTree();
    this.print('\n');
  }

  private setupInterruptHandler() {
    if (this.interruptHandlersRegistered) return;
    
    const handler = () => {
      this.print('\n\n');
      this.printBox('✕ TESTS INTERRUPTED', 'yellow');
      this.print('\n');
      this.printTestTree();
      this.print('\n');
      process.exit(1);
    };
    
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
    this.interruptHandlersRegistered = true;
  }

  private updateStatusLine() {
    if (!this.currentSuite || !this.currentSpec) return;
    
    const suiteName = this.currentSuite.description;
    const passed = this.executableSpecCount - this.failureCount - this.pendingSpecs.length;
    const statusText = `  ${this.colored('dim', '→')} ${suiteName} ${this.colored('gray', `[${passed}/${this.executableSpecCount} passed]`)}`;
    
    this.clearCurrentLine();
    this.print(statusText);
    this.print('\r');
  }

  private clearCurrentLine() {
    this.print('\x1b[2K\r');
  }

  private printSuiteLine(suite: TestSuite, isFinal: boolean) {
    const suiteName = suite.description;
    let displayDots = this.getSpecDots(suite); // current dots

    const prefix = '  ';
    const availableWidth = this.lineWidth - prefix.length;

    let displayName = suiteName;

    const suiteNameLength = displayName.replace(/\.\.\.$/, '').length + (displayName.includes('...') ? 3 : 0);
    const dotsLength = this.countVisualDots(displayDots);

    let padding = ' '.repeat(Math.max(0, availableWidth - suiteNameLength - dotsLength));

    // Shift dots right by one: add a space
    displayDots = ' ' + displayDots;

    this.print(prefix + this.colored('brightBlue', displayName) + padding + displayDots);

    if (!isFinal) {
      this.print('\r'); // carriage return
    }
  }

  private getSpecDots(suite: TestSuite): string {
    return suite.specs.map(spec => this.getSpecSymbol(spec)).join('');
  }

  private getSpecSymbol(spec: TestSpec): string {
    switch (spec.status) {
      case 'passed':
        return this.colored('brightGreen', '●');
      case 'failed':
        return this.colored('brightRed', '✕');
      case 'pending':
        return this.colored('brightYellow', '○');
      default:
        return '';
    }
  }

  private compressDots(suite: TestSuite, sideCount: number): string {
    const dots = suite.specs.map(spec => this.getSpecSymbol(spec));
    
    if (dots.length <= sideCount * 2) {
      return dots.join('');
    }
    
    const start = dots.slice(0, sideCount).join('');
    const end = dots.slice(-sideCount).join('');
    const ellipsis = this.colored('gray', '...');
    
    return start + ellipsis + end;
  }

  private countVisualDots(dotsString: string): number {
    return dotsString.replace(/\x1b\[[0-9;]*m/g, '').length;
  }

  private printFailures() {
    this.print('\n');
    this.printSectionHeader('FAILURES', 'red');
    this.print('\n');
    
    this.failedSpecs.forEach((spec, i) => {
      this.print('\n');
      this.print(this.colored('bold', `  ${i + 1}) ${spec.fullName}\n`));
      this.print(this.colored('gray', `     ${spec.fullName.split(' ').slice(0, -1).join(' ')}\n`));
      
      if (spec.failedExpectations?.length > 0) {
        spec.failedExpectations.forEach((expectation: any) => {
          this.print('\n');
          this.print(this.colored('brightRed', `     ✕ ${expectation.message}\n`));
          
          if (expectation.stack) {
            const stackLines = expectation.stack.split('\n').slice(1, 4);
            stackLines.forEach((line: string) => {
              this.print(this.colored('gray', `       ${line.trim()}\n`));
            });
          }
        });
      }
    });
    
    this.print('\n');
    this.printDivider();
  }

  private printPendingSpecs() {
    this.print('\n');
    this.printSectionHeader('PENDING', 'yellow');
    this.print('\n');
    
    this.pendingSpecs.forEach((spec) => {
      this.print(`\n  ${this.colored('brightYellow', '○')} ${this.colored('dim', spec.fullName)}\n`);
      if (spec.pendingReason) {
        this.print(`    ${this.colored('yellow', spec.pendingReason)}\n`);
      }
    });
    
    this.print('\n');
    this.printDivider();
  }

  private printFinalStatus(overallStatus?: string) {
    if (overallStatus === 'passed') {
      const msg = this.pendingSpecs.length === 0
        ? '✓ ALL TESTS PASSED'
        : `✓ ALL TESTS PASSED (${this.pendingSpecs.length} pending)`;
      this.printBox(msg, 'green');
    } else if (overallStatus === 'failed') {
      this.printBox(`✕ ${this.failureCount} TEST${this.failureCount === 1 ? '' : 'S'} FAILED`, 'red');
    } else if (overallStatus === 'incomplete') {
      this.printBox('⚠ TESTS INCOMPLETE', 'yellow');
    } else {
      this.printBox(`⚠ UNKNOWN STATUS: ${overallStatus}`, 'red');
    }
  }

  private printTestTree() {
    this.print(this.colored('bold', '  Test Results Tree\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n\n'));
    
    this.printSuiteTree(this.rootSuite, 0, true);
  }

  private printSuiteTree(suite: TestSuite, depth: number, isRoot: boolean = false) {
    const indent = '  '.repeat(depth);
    
    if (!isRoot && suite.description) {
      this.print(`${indent}${this.colored('brightBlue', '○')} ${suite.description}\n`);
    }
    
    suite.specs.forEach(spec => {
      const specIndent = isRoot ? indent : indent + '  ';
      const { symbol, color } = this.getSpecTreeSymbol(spec.status);
      
      this.print(`${specIndent}${this.colored(color, symbol)} ${this.colored('gray', spec.description)}`);
      
      if (spec.duration !== undefined) {
        this.print(` ${this.colored('dim', `(${spec.duration}ms)`)}`);
      }
      
      this.print('\n');
      
      if (spec.status === 'failed' && spec.failedExpectations) {
        spec.failedExpectations.forEach(expectation => {
          this.print(`${specIndent}  ${this.colored('brightRed', '↳')} ${this.colored('red', expectation.message)}\n`);
        });
      }
    });
    
    suite.children.forEach(child => {
      this.printSuiteTree(child, isRoot ? depth : depth + 1);
    });
  }

  private getSpecTreeSymbol(status: string): { symbol: string; color: string } {
    switch (status) {
      case 'passed':
        return { symbol: '✓', color: 'brightGreen' };
      case 'failed':
        return { symbol: '✕', color: 'brightRed' };
      case 'pending':
        return { symbol: '○', color: 'brightYellow' };
      case 'running':
        return { symbol: '◷', color: 'cyan' };
      default:
        return { symbol: '?', color: 'white' };
    }
  }

  private printBox(text: string, color: string) {
    const width = text.length + 4;
    const topBottom = '═'.repeat(width);
    
    this.print(this.colored(color, `  ╔${topBottom}╗\n`));
    this.print(this.colored(color, `  ║  ${this.colored('bold', text)}  ║\n`));
    this.print(this.colored(color, `  ╚${topBottom}╝\n`));
  }

  private printSectionHeader(text: string, color: string) {
    this.print(this.colored('bold', this.colored(color, `  ${text}\n`)));
  }

  private printDivider() {
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));
  }

  private printSummary(totalTime: number) {
    const passed = this.executableSpecCount - this.failureCount - this.pendingSpecs.length;
    const total = this.executableSpecCount;
    
    this.print(this.colored('bold', '  Test Summary\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));
    
    if (passed > 0) {
      this.print(this.colored('brightGreen', `  ✓ Passed:  ${passed}\n`));
    }
    if (this.failureCount > 0) {
      this.print(this.colored('brightRed', `  ✕ Failed:  ${this.failureCount}\n`));
    }
    if (this.pendingSpecs.length > 0) {
      this.print(this.colored('brightYellow', `  ○ Pending: ${this.pendingSpecs.length}\n`));
    }
    
    this.print(this.colored('white', `  ━ Total:   ${total}\n`));
    this.print('\n');
    this.print(this.colored('cyan', `  ⏱  Duration: ${totalTime.toFixed(3)}s\n`));
  }

  private colored(color: string, str: string): string {
    return this.showColors ? this.ansi[color] + str + this.ansi.none : str;
  }

  private gatherEnvironmentInfo(): EnvironmentInfo {
    const memUsage = process.memoryUsage();
    const memTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
    const uptime = Math.round(process.uptime());
    
    return {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      arch: process.arch,
      cwd: process.cwd(),
      memory: `${memTotal} MB`,
      pid: process.pid,
      uptime: `${uptime}s`,
    };
  }

  private printEnvironmentInfo() {
    if (!this.envInfo) this.envInfo = this.gatherEnvironmentInfo();
    
    this.print('\n');
    this.print(this.colored('bold', '  Environment\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));
    
    this.print(this.colored('cyan', '  Node.js:   ') + this.colored('white', `${this.envInfo.node}\n`));
    this.print(this.colored('cyan', '  Platform:  ') + this.colored('white', `${this.envInfo.platform}\n`));
    this.print(this.colored('cyan', '  Arch:      ') + this.colored('white', `${this.envInfo.arch}\n`));
    
    this.print(this.colored('cyan', '  PID:       ') + this.colored('white', `${this.envInfo.pid}\n`));
    this.print(this.colored('cyan', '  Uptime:    ') + this.colored('white', `${this.envInfo.uptime}\n`));
    this.print(this.colored('cyan', '  Memory:    ') + this.colored('white', `${this.envInfo.memory} heap\n`));
    
    if (this.envInfo.userAgent) {
      this.printUserAgentInfo(this.envInfo.userAgent);
    }
    
    this.print('\n');
    const cwdShort = this.truncateString(this.envInfo.cwd, 50, true);
    this.print(this.colored('cyan', '  Directory:  ') + this.colored('gray', `${cwdShort}\n`));
  }

  private detectBrowser(userAgent: string): { name: string; version: string } {
    let name = 'Unknown';
    let version = '';

    const ua = userAgent.toLowerCase();

    if (/firefox\/(\d+\.\d+)/.test(ua)) {
      name = 'Firefox';
      version = ua.match(/firefox\/(\d+\.\d+)/)![1];
    } else if (/edg\/(\d+\.\d+)/.test(ua)) {
      name = 'Edge';
      version = ua.match(/edg\/(\d+\.\d+)/)![1];
    } else if (/chrome\/(\d+\.\d+)/.test(ua)) {
      name = 'Chrome';
      version = ua.match(/chrome\/(\d+\.\d+)/)![1];
    } else if (/safari\/(\d+\.\d+)/.test(ua) && /version\/(\d+\.\d+)/.test(ua)) {
      name = 'Safari';
      version = ua.match(/version\/(\d+\.\d+)/)![1];
    } else if (/opr\/(\d+\.\d+)/.test(ua)) {
      name = 'Opera';
      version = ua.match(/opr\/(\d+\.\d+)/)![1];
    }

    return { name, version };
  }

  private printUserAgentInfo(userAgent: UserAgent) {
    const { name: browserName, version: browserVersion } = this.detectBrowser(userAgent.userAgent);

    this.print('\n');
    this.print(this.colored('bold', '  Browser/Navigator\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));

    const shortUA = this.truncateString(userAgent.userAgent, 50);
    this.print(this.colored('cyan', '  User Agent: ') + this.colored('white', `${shortUA}\n`));

    this.print(this.colored('cyan', '  Browser:    ') + this.colored('white', `${browserName} ${browserVersion}\n`));
    
    if (userAgent.platform) {
      this.print(this.colored('cyan', '  Platform:   ') + this.colored('white', `${userAgent.platform}\n`));
    }

    if (userAgent.vendor) {
      this.print(this.colored('cyan', '  Vendor:     ') + this.colored('white', `${userAgent.vendor}\n`));
    }

    if (userAgent.language) {
      this.print(this.colored('cyan', '  Language:   ') + this.colored('white', `${userAgent.language}\n`));
    }

    if (userAgent.languages?.length > 0) {
      const langs = userAgent.languages.join(', ');
      const shortLangs = this.truncateString(langs, 40);
      this.print(this.colored('cyan', '  Languages:  ') + this.colored('white', `${shortLangs}\n`));
    }
  }

  private truncateString(str: string, maxLength: number, fromStart: boolean = false): string {
    if (str.length <= maxLength) return str;
    
    if (fromStart) {
      return '...' + str.slice(-(maxLength - 3));
    }
    return str.substring(0, maxLength - 3) + '...';
  }

  private printTestConfiguration(config: any) {
    if (!config || Object.keys(config).length === 0) return;
    
    this.print('\n');
    this.print(this.colored('bold', '  Test Configuration\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));
    
    if (config.order.random !== undefined || config.order.seed !== undefined) {
      this.print(this.colored('magenta', '  Order:\n'));
      
      if (config.order.random !== undefined) {
        this.print(this.colored('magenta', '    Random:  ') + 
          this.colored('white', config.order.random ? '✓ enabled' : '✗ disabled') + '\n');
      }
      
      if (config.order.seed !== undefined) {
        this.print(this.colored('magenta', '    Seed:    ') + 
          this.colored('white', `${config.order.seed}\n`));
      }
    }
    
    if (config.stopOnSpecFailure !== undefined) {
      this.print(this.colored('magenta', '  Fail Fast: ') + 
        this.colored('white', config.stopOnSpecFailure ? '✓ enabled' : '✗ disabled') + '\n');
    }
    
    if (config.stopSpecOnExpectationFailure !== undefined) {
      this.print(this.colored('magenta', '  Stop Spec: ') + 
        this.colored('white', config.stopSpecOnExpectationFailure ? '✓ enabled' : '✗ disabled') + '\n');
    }
    
    if (config.failSpecWithNoExpectations !== undefined) {
      this.print(this.colored('magenta', '  No Expect: ') + 
        this.colored('white', config.failSpecWithNoExpectations ? '✓ fail' : '✗ pass') + '\n');
    }
  }
}