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
  status: 'passed' | 'failed' | 'pending' | 'running' | 'skipped';
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
  status?: 'passed' | 'failed' | 'pending' | 'running' | 'skipped' | 'incomplete';
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
  private config: any | null = null;
  private resolveJasmineReady: (() => void) | null;
  private envInfo: EnvironmentInfo | null;
  private rootSuite: TestSuite;
  private currentSuite: TestSuite | null;
  private suiteStack: TestSuite[];
  private currentSpec: TestSpec | null;
  private suiteById: Map<string, TestSuite> = new Map();
  private specById: Map<string, TestSpec> = new Map();
  private readonly lineWidth: number = 60;
  private interruptHandlersRegistered: boolean = false;

  constructor() {
    this.print = (...args) => process.stdout.write(util.format(...args));
    this.showColors = this.detectColorSupport();
    this.config = null;
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

   private buildSuiteTree(config: any) {
    this.rootSuite = this.createRootSuite();
    this.suiteById.clear();
    this.specById.clear();
    this.suiteStack = [this.rootSuite];
    this.currentSuite = null;
    this.currentSpec = null;

    this.suiteById.set('root', this.rootSuite);

    // Create all suites first
    if (config.orderedSuites) {
      config.orderedSuites.forEach((suiteConfig: any) => {
        const suite: TestSuite = {
          id: suiteConfig.id,
          description: this.normalizeDescription(suiteConfig.description ?? suiteConfig.id),
          fullName: suiteConfig.fullName ?? suiteConfig.id,
          specs: [],
          children: [],
          status: 'skipped' // Default until we know it will run
        };
        
        this.suiteById.set(suite.id, suite);
      });
    }

    // Create all specs and attach to suites
    if (config.orderedSpecs) {
      config.orderedSpecs.forEach((specConfig: any) => {
        const spec: TestSpec = {
          id: specConfig.id,
          description: specConfig.description ?? specConfig.id,
          fullName: specConfig.fullName ?? specConfig.id,
          status: 'skipped'
        };
        
        this.specById.set(spec.id, spec);
        
        // Find parent suite and attach
        const parentSuiteId = specConfig.suiteId ?? this.findSuiteIdForSpec(specConfig);
        const parentSuite = this.suiteById.get(parentSuiteId) ?? this.rootSuite;
        parentSuite.specs.push(spec);
      });
    }

    // Build hierarchy - connect suites to their parents
    if (config.orderedSuites) {
      config.orderedSuites.forEach((suiteConfig: any) => {
        const suite = this.suiteById.get(suiteConfig.id);
        if (!suite) return;

        const parentSuiteId = suiteConfig.parentSuiteId ?? this.findParentSuiteId(suiteConfig);
        const parentSuite = this.suiteById.get(parentSuiteId) ?? this.rootSuite;
        
        suite.parent = parentSuite;
        if (!parentSuite.children.includes(suite)) {
          parentSuite.children.push(suite);
        }
      });
    }
  }

  private normalizeDescription(desc: any): string {
    if (typeof desc === 'string') return desc;
    if (desc?.en) return desc.en;
    return JSON.stringify(desc);
  }

  private findSuiteIdForSpec(specConfig: any): string {
    // Try to find suite ID from spec's fullName or other hints
    // This is a fallback - ideally suiteId should be in the config
    if (specConfig.suiteId) return specConfig.suiteId;
    
    // If we have a fullName, try to match it with suite fullNames
    if (specConfig.fullName) {
      for (const [id, suite] of this.suiteById) {
        if (id !== 'root' && specConfig.fullName.startsWith(suite.fullName)) {
          return id;
        }
      }
    }
    
    return 'root';
  }

  private findParentSuiteId(suiteConfig: any): string {
    if (suiteConfig.parentSuiteId) return suiteConfig.parentSuiteId;
    
    // Try to deduce from fullName
    if (suiteConfig.fullName) {
      const parts = suiteConfig.fullName.split(' ');
      if (parts.length > 1) {
        const parentFullName = parts.slice(0, -1).join(' ');
        for (const [id, suite] of this.suiteById) {
          if (suite.fullName === parentFullName) {
            return id;
          }
        }
      }
    }
    
    return 'root';
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
    this.config = config;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.rootSuite = this.createRootSuite();
    this.suiteStack = [this.rootSuite];
    this.currentSuite = null;
    this.currentSpec = null;
    
    this.buildSuiteTree(config);
    this.setupInterruptHandler();
    
    this.print('\n');
    this.printBox('Test Runner Started', 'cyan');
    this.printEnvironmentInfo();
    this.printTestConfiguration(config);
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
    
    this.clearCurrentLine();
    this.print('\n');

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
    // Clear the status line (which is on the line above)
    this.print('\r\x1b[1A'); // Move up one line
    this.clearCurrentLine();  // Clear that line
    this.clearCurrentLine();  // Clear current line
    this.print('\n\n');
    this.printBox(`✕ TESTS ABORTED${message ? ': ' + message : ''}`, 'red');
    this.print('\n');
    
    // Calculate elapsed time
    const totalTime = (Date.now() - this.startTime) / 1000;
    
    // Print failures if any
    if (this.failedSpecs.length > 0) {
      this.printFailures();
    }
    
    // Print test tree
    this.printTestTree();
    
    // Print summary
    this.print('\n');
    this.printSummary(totalTime);
    
    this.print('\n');
  }

  private setupInterruptHandler() {
    if (this.interruptHandlersRegistered) return;
    
    const handler = () => {
      // Clear the status line (which is on the line above)
      this.print('\r\x1b[1A'); // Move up one line
      this.clearCurrentLine();  // Clear that line
      this.clearCurrentLine();  // Clear current line
      this.print('\n');
      
      // Calculate elapsed time
      const totalTime = (Date.now() - this.startTime) / 1000;
      
      // Print failures if any
      if (this.failedSpecs.length > 0) {
        this.printFailures();
      }
      
      // Print test tree
      this.printTestTree();
      
      // Print summary
      this.print('\n');
      this.printSummary(totalTime);
      
      this.print('\n');
      this.printBox('✕ TESTS INTERRUPTED', 'yellow');
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
    const statusText = `\n  ${this.colored('dim', '→')} ${suiteName} ${this.colored('gray', `[${passed}/${this.executableSpecCount} passed]`)}`;
    this.clearCurrentLine();
    this.print(statusText);
    this.print('\r\x1b[1A');
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

    let padding = ' '.repeat(Math.max(0, availableWidth - suiteNameLength - dotsLength + 1));

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
        return this.colored('brightRed', '⨯');
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
    this.print(this.colored('red', '  ────────────────────────────────────────────────────────────\n'));

    if (!this.failedSpecs.length) return;

    this.failedSpecs.forEach((spec, idx) => {
      // Print numbered spec header
      const header = `  ${idx + 1}) ${spec.fullName}`;
      this.print(this.colored('bold', header + '\n'));

      if (spec.failedExpectations?.length > 0) {
        spec.failedExpectations.forEach((expectation: any, exIndex: number) => {
          const marker = this.colored('brightRed', '✕');
          const messageLines = (expectation.message || '').split('\n').map((l: string) => l.trim());

          // Print the failure message, all aligned to same margin
          this.print(`  ${marker} ${this.colored('brightRed', messageLines[0])}\n`);

          // Continuation lines of same message
          for (let li = 1; li < messageLines.length; li++) {
            this.print(`    ${this.colored('brightRed', messageLines[li])}\n`);
          }

          // Stack trace — lightly indented and gray
          if (expectation.stack) {
            const stackLines = expectation.stack.split('\n').slice(1, 6).map((l: string) => l.trim());
            stackLines.forEach((line: string) => {
              this.print(this.colored('gray', `      at ${line}\n`));
            });
          }

          // Space between multiple expectations for same spec
          if (exIndex < spec.failedExpectations.length - 1) this.print('\n');
        });
      }

      // Extra spacing between specs
      this.print('\n');
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
    if (!this.config) return;

    const { orderedSuites = [], orderedSpecs = [], specById = {}, suiteById = {} } = this.config;

    this.print(this.colored('bold', '  Problem Suites\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));

    // Build suite map with specs
    const suiteMap: Record<string, { description: string; specs: TestSpec[] }> = {};

    // Initialize suites
    orderedSuites.forEach((suite: any)  => {
      let desc = suite.description ?? suite.id;
      if (typeof desc !== 'string') {
        if (desc?.en) desc = desc.en;
        else desc = JSON.stringify(desc);
      }
      suiteMap[suite.id] = { description: desc, specs: [] };
    });

    // Attach specs
    orderedSpecs.forEach((spec: any) => {
      const info = specById[spec.id];
      const specStatus: TestSpec = {
        id: spec.id,
        description: spec.description ?? spec.id,
        fullName: spec.fullName ?? spec.id,
        status: info?.status ?? 'skipped',
        duration: info?.duration,
        failedExpectations: info?.failedExpectations,
        pendingReason: info?.pendingReason
      };

      const suiteId = info?.suiteId ?? 'unknown';
      if (!suiteMap[suiteId]) {
        suiteMap[suiteId] = { description: suiteId, specs: [] };
      }
      suiteMap[suiteId].specs.push(specStatus);
    });

    // Print only problem suites
    orderedSuites.forEach((suite: any) => {
      const s = suiteMap[suite.id];
      if (!s) return;

      const specs = s.specs;
      const hasFailed = specs.some(sp => sp.status === 'failed');
      const hasPending = specs.some(sp => sp.status === 'pending');
      const hasSkipped = specs.some(sp => sp.status === 'skipped');
      const hasIncomplete = specs.some(sp => !sp.status || sp.status === 'running') || specs.length === 0;

      let status: 'failed' | 'pending' | 'skipped' | 'incomplete' | null = null;
      if (hasFailed) status = 'failed';
      else if (hasPending) status = 'pending';
      else if (hasSkipped && !hasFailed && !hasPending) status = 'skipped';
      else if (hasIncomplete) status = 'incomplete';

      if (!status) return;

      const { symbol, color } = this.getSuiteSymbol(status);
      this.print(`  ${this.colored(color, symbol)} ${s.description}\n`);
    });
  }

  private addSuitesFromTree(suite: TestSuite, suiteMap: Record<string, any>) {
    if (suite.id !== 'root') {
      suiteMap[suite.id] = {
        id: suite.id,
        description: suite.description,
        fullName: suite.fullName,
        specs: [...suite.specs], // Copy specs
        children: suite.children.map(child => child.id), // Store child IDs for hierarchy
        status: this.determineSuiteStatusFromInternal(suite)
      };
    }

    // Recursively add children
    suite.children.forEach(child => {
      this.addSuitesFromTree(child, suiteMap);
    });
  }

  private collectSuiteIds(suite: TestSuite, result: string[]) {
    if (suite.id !== 'root') {
      result.push(suite.id);
    }

    suite.children.forEach(child => {
      this.collectSuiteIds(child, result);
    });
  }

  private determineSuiteStatusFromInternal(suite: TestSuite): 'passed' | 'failed' | 'pending' | 'skipped' | 'incomplete' | null {
    const specs = suite.specs;
    const children = suite.children;

    const hasFailed = specs.some(s => s.status === 'failed');
    const hasPending = specs.some(s => s.status === 'pending');
    const hasRunning = specs.some(s => s.status === 'running');
    const hasUndefined = specs.some(s => !s.status);
    const allSkipped = specs.length > 0 && specs.every(s => s.status === 'skipped');
    const allPassed = specs.length > 0 && specs.every(s => s.status === 'passed');

    // Check children recursively
    const childStatuses = children.map(child => this.determineSuiteStatusFromInternal(child));
    const hasFailedChildren = childStatuses.some(status => status === 'failed');
    const hasPendingChildren = childStatuses.some(status => status === 'pending');
    const hasIncompleteChildren = childStatuses.some(status => status === 'incomplete');

    if (hasFailed || hasFailedChildren) return 'failed';
    if (hasPending || hasPendingChildren) return 'pending';
    if (hasRunning || hasUndefined || hasIncompleteChildren) return 'incomplete';
    if (allSkipped) return 'skipped';
    if (allPassed) return 'passed';

    return specs.length === 0 ? 'incomplete' : null;
  }

  private getSuiteSymbol(status: 'failed' | 'pending' | 'skipped' | 'incomplete' | 'passed'): { symbol: string; color: string } {
    switch (status) {
      case 'failed': return { symbol: '✕', color: 'brightRed' };
      case 'pending': return { symbol: '○', color: 'brightYellow' };
      case 'skipped': return { symbol: '⊘', color: 'gray' };
      case 'incomplete': return { symbol: '◷', color: 'cyan' };
      case 'passed': return { symbol: '✓', color: 'brightGreen' };
      default: return { symbol: '?', color: 'white' };
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
    const notRun = this.config.totalSpecsDefined - this.executableSpecCount;
    const duration = `${totalTime.toFixed(3)}s`;

    const lineWidth = 63;

    // Build right-aligned info (total and duration)
    const rightInfo = `total: ${total}  time: ${duration}`;
    const title = '  Test Summary';
    const spacing = Math.max(1, lineWidth - title.length - rightInfo.length - 1);

    // Header
    const headerLine =
      this.colored('bold', title) +
      ' '.repeat(spacing) +
      this.colored('gray', rightInfo);

    this.print('\n');
    this.print(headerLine + '\n');
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));

    // Inline summary line
    const parts: string[] = [];

    if (passed > 0)
      parts.push(this.colored('brightGreen', `✓ Passed: ${passed}`));

    if (this.failureCount > 0)
      parts.push(this.colored('brightRed', `✕ Failed: ${this.failureCount}`));

    if (this.pendingSpecs.length > 0)
      parts.push(this.colored('brightYellow', `○ Pending: ${this.pendingSpecs.length}`));

    if (notRun > 0)
      parts.push(this.colored('gray', `⊘ Not Run: ${notRun}`));

    if (parts.length > 0)
      this.print('  ' + parts.join(this.colored('gray', '  |  ')) + '\n');
    else
      this.print(this.colored('gray', '  (no specs executed)\n'));
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

    const lineWidth = 63; // adjust or detect terminal width

    const orderPart =
      config.order?.random !== void 0
        ? (config.order.random ? "random" : "sequential")
        : null;

    const seedPart =
      config.order?.seed !== void 0 ? `seed: ${config.order.seed}` : null;

    const rightInfo = [orderPart, seedPart].filter(Boolean).join("  ");

    // Header line with right alignment
    const title = "  Test Configuration";
    const spacing = Math.max(1, lineWidth - title.length - rightInfo.length - 1);
    const headerLine =
      this.colored("bold", title) +
      " ".repeat(spacing) +
      this.colored("gray", rightInfo);

    this.print("\n");
    this.print(headerLine + "\n");
    this.print(
      this.colored(
        "gray",
        "  ────────────────────────────────────────────────────────────\n"
      )
    );

    // Then list the other flags in single line
    const parts = [];

    if (config.stopOnSpecFailure !== void 0)
      parts.push(
        this.colored("magenta", "Fail Fast:") +
          " " +
          this.colored("white", config.stopOnSpecFailure ? "✓ enabled" : "✗ disabled")
      );

    if (config.stopSpecOnExpectationFailure !== void 0)
      parts.push(
        this.colored("magenta", "Stop Spec:") +
          " " +
          this.colored("white", config.stopSpecOnExpectationFailure ? "✓ enabled" : "✗ disabled")
      );

    if (config.failSpecWithNoExpectations !== void 0)
      parts.push(
        this.colored("magenta", "No Expect:") +
          " " +
          this.colored("white", config.failSpecWithNoExpectations ? "✓ fail" : "✗ pass")
      );

    if (parts.length > 0) {
      this.print("  " + parts.join(this.colored("gray", "  |  ")) + "\n");
    }
  }
}