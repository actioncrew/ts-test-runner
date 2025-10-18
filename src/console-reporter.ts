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
  private jasmineReady: Promise<void> | null;
  private resolveJasmineReady: (() => void) | null;
  private envInfo: EnvironmentInfo | null;
  private testConfig: any;
  private rootSuite: TestSuite;
  private currentSuite: TestSuite | null;
  private suiteStack: TestSuite[];
  private currentSpec: TestSpec | null;
  private readonly lineWidth: number = 60;

  constructor() {
    this.print = (...args) => process.stdout.write(util.format(...args));
    this.showColors = true;
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.startTime = 0;
    this.jasmineReady = new Promise((resolve) => {
      this.resolveJasmineReady = resolve;
    });
    this.resolveJasmineReady = null;
    this.envInfo = null;
    this.testConfig = null;
    this.rootSuite = {
      id: 'root',
      description: 'Root Suite',
      fullName: '',
      specs: [],
      children: []
    };
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

  userAgent(message: any) {
    this.envInfo = this.gatherEnvironmentInfo();
    let userAgent = { ...message };
    delete userAgent?.timestamp;
    delete userAgent?.type;
    this.envInfo = {
      ...this.envInfo!,
      userAgent
    };

    this.resolveJasmineReady?.();
  }

  jasmineStarted(config: any) {
    this.startTime = Date.now();
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.testConfig = config;
    this.rootSuite = {
      id: 'root',
      description: 'Root Suite',
      fullName: '',
      specs: [],
      children: []
    };
    this.suiteStack = [this.rootSuite];
    this.currentSuite = null;
    this.currentSpec = null;
    
    // Setup interrupt handler
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
    
    // Add to parent's children
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
    
    // Update the spec in the tree
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
    
    // Update the suite line with new dots
    if (this.currentSuite) {
      this.clearCurrentLine();
      this.printSuiteLine(this.currentSuite, false);
      this.updateStatusLine();
    }
  }

  suiteDone(result: any) {
    // Print final suite line and move to next line
    this.clearCurrentLine();
    if (this.currentSuite) {
      this.printSuiteLine(this.currentSuite, true);
      this.print('\n');
    }
    
    this.suiteStack.pop();
    this.currentSuite = this.suiteStack[this.suiteStack.length - 1];
  }

  jasmineDone(result: any) {
    const totalTime = result ? result.totalTime / 1000 : (Date.now() - this.startTime) / 1000;
    const failedSpecsPresent = this.failedSpecs.length > 0;
    const pendingSpecsPresent = this.pendingSpecs.length > 0;

    this.print('\n\n');
    this.printDivider();

    // Display failures
    if (failedSpecsPresent) {
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

    // Display pending specs
    if (pendingSpecsPresent) {
      this.print('\n');
      this.printSectionHeader('PENDING', 'yellow');
      this.print('\n');
      
      this.pendingSpecs.forEach((spec, i) => {
        this.print(`\n  ${this.colored('brightYellow', '○')} ${this.colored('dim', spec.fullName)}\n`);
        if (spec.pendingReason) {
          this.print(`    ${this.colored('yellow', spec.pendingReason)}\n`);
        }
      });
      
      this.print('\n');
      this.printDivider();
    }

    // Display summary
    this.print('\n');
    this.printSummary(totalTime);
    
    // Final status
    this.print('\n');
    if (result.overallStatus === 'passed') {
      if (this.pendingSpecs.length === 0) {
        this.printBox('✓ ALL TESTS PASSED', 'green');
      } else {
        this.printBox(`✓ ALL TESTS PASSED (${this.pendingSpecs.length} pending)`, 'green');
      }
    } else if (result.overallStatus === 'failed') {
      this.printBox(`✕ ${this.failureCount} TEST${this.failureCount === 1 ? '' : 'S'} FAILED`, 'red');
    } else if (result.overallStatus === 'incomplete') {
      this.printBox('⚠ TESTS INCOMPLETE', 'yellow');
    } else {
      this.printBox(`⚠ UNKNOWN STATUS: ${result.overallStatus}`, 'red');
    }
    
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
    const dots = this.getSpecDots(suite);
    
    // Calculate available space
    const prefix = '  ';
    const availableWidth = this.lineWidth - prefix.length;
    
    // Calculate lengths (ANSI codes don't count in display width)
    const suiteNameLength = suiteName.length;
    const dotsLength = suite.specs.length; // Each dot is 1 char visually
    
    let displayName = suiteName;
    let displayDots = dots;
    
    // If doesn't fit, we need to shrink
    if (suiteNameLength + 1 + dotsLength > availableWidth) {
      const minDots = 5; // Minimum dots to show pattern
      const ellipsis = '...';
      
      // Try to fit with compressed dots
      if (dotsLength > minDots && suiteNameLength + 1 + minDots + ellipsis.length <= availableWidth) {
        // Show beginning and end of dots with ellipsis
        const visibleDots = Math.max(minDots, availableWidth - suiteNameLength - 1 - ellipsis.length);
        const sideCount = Math.floor(visibleDots / 2);
        displayDots = this.compressDots(suite, sideCount);
      } else {
        // Truncate suite name
        const maxNameLength = availableWidth - dotsLength - 4; // Reserve space for "..." and dots
        if (maxNameLength > 10) {
          displayName = suiteName.substring(0, maxNameLength) + '...';
        } else {
          // Extreme case: truncate both
          displayName = suiteName.substring(0, 10) + '...';
          displayDots = this.compressDots(suite, 3);
        }
      }
    }
    
    // Calculate padding
    const displayNameLength = displayName.length + (displayName.includes('...') ? 0 : 0);
    const displayDotsCount = this.countVisualDots(displayDots);
    const padding = ' '.repeat(Math.max(0, availableWidth - displayNameLength - displayDotsCount + 1));
    
    this.print(prefix + this.colored('brightBlue', displayName) + padding + displayDots);
    
    if (!isFinal) {
      this.print('\r'); // Return to start without newline
    }
  }

  private getSpecDots(suite: TestSuite): string {
    return suite.specs.map(spec => {
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
    }).join('');
  }

  private compressDots(suite: TestSuite, sideCount: number): string {
    const dots = suite.specs.map(spec => {
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
    });
    
    if (dots.length <= sideCount * 2) {
      return dots.join('');
    }
    
    const start = dots.slice(0, sideCount).join('');
    const end = dots.slice(-sideCount).join('');
    const ellipsis = this.colored('gray', '...');
    
    return start + ellipsis + end;
  }

  private countVisualDots(dotsString: string): number {
    // Count actual visible characters (ignoring ANSI codes)
    return dotsString.replace(/\x1b\[[0-9;]*m/g, '').length;
  }

  private printTestTree() {
    this.print(this.colored('bold', '  Test Results Tree\n'));
    this.print(this.colored('gray', '  ─────────────────\n\n'));
    
    this.printSuiteTree(this.rootSuite, 0, true);
  }

  private printSuiteTree(suite: TestSuite, depth: number, isRoot: boolean = false) {
    const indent = '  '.repeat(depth);
    
    // Don't print root suite itself
    if (!isRoot && suite.description) {
      this.print(`${indent}${this.colored('brightBlue', '○')} ${suite.description}\n`);
    }
    
    // Print specs
    suite.specs.forEach(spec => {
      const specIndent = isRoot ? indent : indent + '  ';
      let symbol = '';
      let color = 'white';
      
      switch (spec.status) {
        case 'passed':
          symbol = '✓';
          color = 'brightGreen';
          break;
        case 'failed':
          symbol = '✕';
          color = 'brightRed';
          break;
        case 'pending':
          symbol = '○';
          color = 'brightYellow';
          break;
        case 'running':
          symbol = '◷';
          color = 'cyan';
          break;
      }
      
      this.print(`${specIndent}${this.colored(color, symbol)} ${this.colored('gray', spec.description)}`);
      
      if (spec.duration !== undefined) {
        this.print(` ${this.colored('dim', `(${spec.duration}ms)`)}`);
      }
      
      this.print('\n');
      
      // Print failure details if failed
      if (spec.status === 'failed' && spec.failedExpectations) {
        spec.failedExpectations.forEach(expectation => {
          this.print(`${specIndent}  ${this.colored('brightRed', '↳')} ${this.colored('red', expectation.message)}\n`);
        });
      }
    });
    
    // Print child suites
    suite.children.forEach(child => {
      this.printSuiteTree(child, isRoot ? depth : depth + 1);
    });
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
    this.print(this.colored('gray', '  ────────────\n'));
    
    // Stats grid
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

  private plural(str: string, count: number): string {
    return count === 1 ? str : str + 's';
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
    this.print(this.colored('gray', '  ───────────\n'));
    
    // System info
    this.print(this.colored('cyan', '  Node.js:   ') + this.colored('white', `${this.envInfo!.node}\n`));
    this.print(this.colored('cyan', '  Platform:  ') + this.colored('white', `${this.envInfo!.platform}\n`));
    this.print(this.colored('cyan', '  Arch:      ') + this.colored('white', `${this.envInfo!.arch}\n`));
    
    // Process info
    this.print(this.colored('cyan', '  PID:       ') + this.colored('white', `${this.envInfo!.pid}\n`));
    this.print(this.colored('cyan', '  Uptime:    ') + this.colored('white', `${this.envInfo!.uptime}\n`));
    this.print(this.colored('cyan', '  Memory:    ') + this.colored('white', `${this.envInfo!.memory} heap\n`));
    
    // Navigator info (if available - browser/Electron environments)
    let userAgent = this.envInfo!.userAgent;
    if (userAgent) {
      this.print('\n');
      this.print(this.colored('bold', '  Browser/Navigator\n'));
      this.print(this.colored('gray', '  ─────────────────\n'));
      
      const shortUA = userAgent.userAgent.length > 50 
        ? userAgent.userAgent.substring(0, 47) + '...' 
        : userAgent.userAgent;
      this.print(this.colored('cyan', '  User Agent: ') + this.colored('gray', `${shortUA}\n`));
      
      if (userAgent.appName) {
        this.print(this.colored('cyan', '  App Name:   ') + this.colored('white', `${userAgent.appName}\n`));
      }
      
      if (userAgent.appVersion) {
        const shortVersion = userAgent.appVersion.length > 40 
          ? userAgent.appVersion.substring(0, 37) + '...' 
          : userAgent.appVersion;
        this.print(this.colored('cyan', '  App Version:') + this.colored('white', ` ${shortVersion}\n`));
      }
      
      if (userAgent.platform) {
        this.print(this.colored('cyan', '  Platform:   ') + this.colored('white', `${userAgent.platform}\n`));
      }
      
      if (userAgent.vendor) {
        this.print(this.colored('cyan', '  Vendor:     ') + this.colored('white', `${userAgent.vendor}\n`));
      }
      
      if (userAgent.language) {
        this.print(this.colored('cyan', '  Language:   ') + this.colored('white', `${userAgent.language}\n`));
      }
      
      if (userAgent.languages && userAgent.languages.length > 0) {
        const langs = userAgent.languages.join(', ');
        const shortLangs = langs.length > 40 
          ? langs.substring(0, 37) + '...' 
          : langs;
        this.print(this.colored('cyan', '  Languages:  ') + this.colored('white', `${shortLangs}\n`));
      }
    }
    
    // Working directory (truncate if too long)
    this.print('\n');
    const cwdShort = this.envInfo!.cwd.length > 50 
      ? '...' + this.envInfo!.cwd.slice(-47) 
      : this.envInfo!.cwd;
    this.print(this.colored('cyan', '  Directory:  ') + this.colored('gray', `${cwdShort}\n`));
  }

  private printTestConfiguration(config: any) {
    if (!config || Object.keys(config).length === 0) return;
    
    this.print('\n');
    this.print(this.colored('bold', '  Test Configuration\n'));
    this.print(this.colored('gray', '  ──────────────────\n'));
    
    // Order configuration
    if (config.random !== undefined || config.seed !== undefined) {
      this.print(this.colored('magenta', '  Order:\n'));
      
      if (config.random !== undefined) {
        this.print(this.colored('magenta', '    Random:  ') + 
          this.colored('white', config.random ? '✓ enabled' : '✗ disabled') + '\n');
      }
      
      if (config.seed !== undefined) {
        this.print(this.colored('magenta', '    Seed:    ') + 
          this.colored('white', `${config.seed}\n`));
      }
    }
    
    // Other configuration options
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