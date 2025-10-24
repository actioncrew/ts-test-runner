import util from 'util';
import { logger, wrapLine } from './console-repl';
import { MAX_LENGTH } from 'picomatch/lib/constants';

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
  status: 'passed' | 'failed' | 'pending' | 'incomplete' | 'skipped' | 'running';
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
  status?: TestStatus;
}

export type TestStatus = 'passed' | 'failed' | 'pending' | 'skipped' | 'running' | 'incomplete';

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
  private readonly lineWidth: number = 63;
  private interruptHandlersRegistered: boolean = false;
  private interrupted = false;

  constructor() {
    this.print = (...args) => logger.printRaw(util.format(...args));
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
      none: '\x1B[0m',
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
      id: 'suite0',
      description: 'Jasmine__TopLevel__Suite',
      fullName: '',
      specs: [],
      children: [],
      status: 'skipped'
    };
  }

  private buildSuiteTree(config: any) {
    // Create root suite
    this.rootSuite = this.createRootSuite();
    this.suiteById.clear();
    this.specById.clear();
    this.suiteStack = [this.rootSuite];
    this.currentSuite = null;
    this.currentSpec = null;

    this.suiteById.set(this.rootSuite.id, this.rootSuite);

    // 1️⃣ Register suites
    if (config.orderedSuites) {
      config.orderedSuites.forEach((suiteConfig: any) => {
        const suite = {
          id: suiteConfig.id,
          description: this.normalizeDescription(suiteConfig.description ?? suiteConfig.id),
          fullName: suiteConfig.fullName ?? suiteConfig.id,
          specs: [],
          children: [],
          parent: undefined,
          status: 'skipped' as const // default until executed
        };
        this.suiteById.set(suite.id, suite);
      });
    }

    // 2️⃣ Attach specs to their suites (skip root)
    if (config.orderedSpecs) {
      config.orderedSpecs.forEach((specConfig: any) => {
        const spec = {
          id: specConfig.id,
          description: specConfig.description ?? specConfig.id,
          fullName: specConfig.fullName ?? specConfig.id,
          status: 'skipped' as const
        };

        this.specById.set(spec.id, spec);

        const parentSuiteId =
          specConfig.suiteId ?? this.findSuiteIdForSpec(specConfig);
        const parentSuite = this.suiteById.get(parentSuiteId);

        if (parentSuite && parentSuite.id !== this.rootSuite.id) {
          parentSuite.specs.push(spec);
        } else {
          // orphaned spec → does not belong to any known suite
          this.rootSuite.specs.push(spec);
        }
      });
    }

    // 3️⃣ Attach suites to their parents
    if (config.orderedSuites) {
      config.orderedSuites.forEach((suiteConfig: any) => {
        const suite = this.suiteById.get(suiteConfig.id);
        if (!suite) return;

        const parentSuiteId =
          suiteConfig.parentSuiteId ?? this.findParentSuiteId(suiteConfig);
        const parentSuite =
          this.suiteById.get(parentSuiteId) ?? this.rootSuite;

        if (parentSuite.id !== suite.id) {
          suite.parent = parentSuite;
          if (!parentSuite.children.includes(suite)) {
            parentSuite.children.push(suite);
          }
        }
      });
    }

    // 4️⃣ Clean up root specs (optional)
    if (this.rootSuite.specs.length > 0) {
      logger.println(`⚠️  ${this.rootSuite.specs.length} orphan specs attached directly to root.`);
    }

    // Debug summary
    const totalSuites = this.suiteById.size - 1;
    const totalSpecs = this.specById.size;
    logger.println(`🧩 Suite tree built (${totalSuites} suites, ${totalSpecs} specs).`);
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
        if (id !== this.rootSuite.id && specConfig.fullName.startsWith(suite.fullName)) {
          return id;
        }
      }
    }
    
    return this.rootSuite.id;
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
    
    return this.rootSuite.id;
  }

  userAgent(message: any) {
    this.envInfo = this.gatherEnvironmentInfo();
    if(message) {
      const userAgent = { ...message };
      delete userAgent?.timestamp;
      delete userAgent?.type;
      this.envInfo = {
        ...this.envInfo,
        userAgent
      };
    }
    
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
    this.interrupted = false;
    
    this.buildSuiteTree(config);
    this.setupInterruptHandler();
    
    this.print('\n');
    this.printBox('Test Runner Started', 'cyan');
    this.printEnvironmentInfo();
    this.printTestConfiguration(config);
  }

  suiteStarted(config: any) {
    if (this.interrupted) return;

    // Try to get or create the suite node
    let suite = this.suiteById.get(config.id);
    const parentSuite = this.suiteStack[this.suiteStack.length - 1];

    if (!suite) {
      // Create new suite node if not built from config
      suite = {
        id: config.id,
        description: config.description,
        fullName: config.fullName,
        specs: [],
        children: [],
        parent: parentSuite,
        status: 'running'
      };
      this.suiteById.set(suite.id, suite);
    } else {
      suite.status = 'running';
      suite.parent = parentSuite;
    }

    // Attach to parent if not already
    if (parentSuite && !parentSuite.children.includes(suite)) {
      parentSuite.children.push(suite);
    }

    // Push to stack
    this.suiteStack.push(suite);
    this.currentSuite = suite;

    // UI feedback
    if (config.description) {
      this.clearCurrentLine();
      this.printSuiteLine(suite, false);
    }
  }

  specStarted(config: any) {
    if (this.interrupted) return;
    
    const spec = this.specById.get(config.id) ?? {
      id: config.id,
      description: config.description,
      fullName: config.fullName,
      status: 'running'
    };

    spec.status = 'running';
    this.specById.set(spec.id, spec);
    this.currentSpec = spec;

    // Attach to current suite
    if (this.currentSuite) {
      if (!this.currentSuite.specs.includes(spec)) {
        this.currentSuite.specs.push(spec);
      }
    } else {
      // Fallback to root if somehow outside any suite
      this.rootSuite.specs.push(spec);
    }

    this.updateStatusLine();
  }

  specDone(result: any) {
    if (this.interrupted) return;
    
    this.specCount++;

    const spec = this.specById.get(result.id);
    if (spec) {
      spec.status = result.status;
      spec.duration = result.duration;
      spec.failedExpectations = result.failedExpectations;
      spec.pendingReason = result.pendingReason;
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
      default:
        break;
    }

    this.currentSpec = null;

    // Update suite display
    if (this.currentSuite) {
      this.clearCurrentLine();
      this.printSuiteLine(this.currentSuite, false);
      this.updateStatusLine();
    }
  }

  suiteDone(result: any) {
    if (this.interrupted) return;
    
    const suite = this.suiteStack[this.suiteStack.length - 1];
    if (!suite) return;

    // Mark suite result
    suite.status = this.determineSuiteStatusFromInternal(suite);

    // Optional UI output
    this.clearCurrentLine();
    this.printSuiteLine(suite, true);
    this.print('\n');

    // Pop from stack
    this.suiteStack.pop();
    this.currentSuite = this.suiteStack[this.suiteStack.length - 1] ?? null;
  }

  jasmineDone(result: any) {
    const totalTime = result?.totalTime 
      ? result.totalTime / 1000 
      : (Date.now() - this.startTime) / 1000;
    
    this.clearCurrentLine();

    if (this.failedSpecs.length > 0) {
      this.printFailures();
    }

    if (this.pendingSpecs.length > 0) {
      this.printPendingSpecs();
    }

    this.printSummary(totalTime);
    
    this.print('\n');
    this.printFinalStatus(result?.overallStatus);
    
    this.print('\n\n');

    return this.failureCount;
  }

  /** Mark all specs and suites that were never executed as skipped */
  markUnexecutedAsSkipped() {
    // Mark the currently running spec as incomplete (if exists)
    if (this.currentSpec) {
      if (!this.currentSpec.status || this.currentSpec.status === "running") {
        this.currentSpec.status = "incomplete";
      }
    }

    // Mark the currently running suite as incomplete (if exists)
    if (this.currentSuite && this.currentSuite.id !== this.rootSuite.id) {
      if (!this.currentSuite.status || this.currentSuite.status === "running") {
        this.currentSuite.status = "incomplete";
      }
    }

    // All other unexecuted specs are skipped
    for (const [id, spec] of this.specById) {
      if (this.currentSpec && id === this.currentSpec.id) continue;
      if (!spec.status || spec.status === "running") {
        spec.status = "skipped";
      }
    }

    // All other unexecuted suites are skipped
    for (const [id, suite] of this.suiteById) {
      if (id === this.rootSuite.id) continue;
      if (this.currentSuite && id === this.currentSuite.id) continue;
      if (!suite.status || suite.status === "running") {
        suite.status = "skipped";
      }
    }
  }

  testsAborted(message?: string) {
    // Clear the status line (which is on the line above)
    this.print('\r\x1b[1A'); // Move up one line
    this.clearCurrentLine();  // Clear that line
    this.clearCurrentLine();  // Clear current line
    this.print('\n');
    
    // Mark all unexecuted specs as skipped
    this.markUnexecutedAsSkipped();
    
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
  }

  /** Determine suite status based on its specs and children */
  private determineSuiteStatusFromInternal(suite: TestSuite): TestStatus {
    // Leaf suite: check specs
    if (suite.specs.length > 0) {
      const hasFailed = suite.specs.some(s => s.status === 'failed');
      if (hasFailed) return 'failed';

      const hasPending = suite.specs.some(s => s.status === 'pending');
      if (hasPending) return 'pending';

      const hasRunning = suite.specs.some(s => s.status === 'running');
      if (hasRunning) return 'incomplete';

      const hasSkipped = suite.specs.every(s => s.status === 'skipped');
      if (hasSkipped) return 'skipped';

      return 'passed';
    }

    // Non-leaf suite: check children recursively
    if (suite.children.length > 0) {
      let childStatuses = suite.children.map(child => this.determineSuiteStatusFromInternal(child));
      if (childStatuses.includes('failed')) return 'failed';
      if (childStatuses.includes('pending')) return 'pending';
      if (childStatuses.includes('incomplete')) return 'incomplete';
      if (childStatuses.every(s => s === 'skipped')) return 'skipped';
      return 'passed';
    }

    // Empty suite
    return 'skipped';
  }

  private setupInterruptHandler() {
    if (this.interruptHandlersRegistered) return;
    process.once('SIGINT', this.testsAborted.bind(this));
    process.once('SIGTERM', this.testsAborted.bind(this));
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

    let padding = ' '.repeat(Math.max(0, availableWidth - suiteNameLength - dotsLength - 1));

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
      const header = wrapLine(`${idx + 1}) ${spec.fullName}`, this.lineWidth, 1);
      header.forEach(line => (this.print(this.colored("white", line)), this.print('\n')));

      if (spec.failedExpectations?.length > 0) {
        spec.failedExpectations.forEach((expectation: any, exIndex: number) => {
          const messageLines = wrapLine(`✕ ${logger.reformat(expectation.message, { width: this.lineWidth, align: 'left' }).map((l: string) => l.trim()).join(' ')}`, this.lineWidth, 1);
          // Continuation lines of same message
          messageLines.forEach(line => (this.print(this.colored('brightRed', line)), this.print('\n')));

          // Stack trace — lightly indented and gray
          if (expectation.stack) {
            const stackLines = wrapLine(logger.reformat(expectation.stack, { width: MAX_LENGTH, align: 'left' }).map((l: string) => l.trim()).join(' '), this.lineWidth, 2);
            stackLines.forEach(line => (this.print(this.colored('gray', line)), this.print('\n')));
          }

          // Space between multiple expectations for same spec
          if (exIndex < spec.failedExpectations.length - 1) this.print('\n');
        });
      }

      // Extra spacing between specs
      this.print('\n');
    });
  }

  private printPendingSpecs() {
    this.print('\n');
    this.printSectionHeader('PENDING', 'yellow');
    this.print(this.colored('yellow', '  ────────────────────────────────────────────────────────────\n'));

    
    this.pendingSpecs.forEach((spec) => {
      this.print(`  ${this.colored('brightYellow', '○')} ${this.colored('dim', spec.fullName)}\n`);
      if (spec.pendingReason) {
        this.print(`    ${this.colored('yellow', spec.pendingReason)}\n`);
      }
    });
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
    this.print(this.colored('bold', '  Demanding Attention\n'));
    this.print(this.colored('gray', '  ────────────────────────────────────────────────────────────\n'));

    // Calculate suite statuses for ALL suites (including those that never started)
    for (const [id, suite] of this.suiteById) {
      this.calculateSuiteStatuses(suite);
    }

    // Print all top-level suites (those whose parent is rootSuite)
    let hasProblems = false;
    
    for (const [id, suite] of this.suiteById) {
      // Skip root suite itself
      if (suite.id === this.rootSuite.id) continue;
      
      // Only print top-level suites (direct children of root)
      // Their children will be printed recursively
      if (!suite.parent || suite.parent.id === this.rootSuite.id) {
        if (this.printProblemSuite(suite, 1)) {
          hasProblems = true;
        }
      }
    }

    if (!hasProblems) {
      this.print('  ' + this.colored('brightGreen', '✓') + ' ' + this.colored('dim', 'All suites completed successfully\n'));
    }
  }

  private calculateSuiteStatuses(suite: TestSuite): TestStatus {
    const childStatuses = suite.children.map(child => this.calculateSuiteStatuses(child));

    // Normalize spec statuses first
    for (const spec of suite.specs) {
      if (!spec.status) {
        spec.status = 'skipped';
      } else if (spec.status === 'running') {
        spec.status = 'incomplete';
      }
    }

    const specs = suite.specs;
    const failedCount = specs.filter(s => s.status === 'failed').length;
    const pendingCount = specs.filter(s => s.status === 'pending').length;
    const incompleteCount = specs.filter(s => s.status === 'incomplete').length;
    const skippedCount = specs.filter(s => s.status === 'skipped').length;

    const hasFailedChildren = childStatuses.includes('failed');
    const hasPendingChildren = childStatuses.includes('pending');
    const hasIncompleteChildren = childStatuses.includes('incomplete');

    // ⚠️ FIX: Check incomplete status BEFORE passed status
    if (failedCount > 0 || hasFailedChildren) {
      suite.status = 'failed';
    } else if (incompleteCount > 0 || hasIncompleteChildren) {
      suite.status = 'incomplete';  // This should come before pending/passed
    } else if (pendingCount > 0 || hasPendingChildren) {
      suite.status = 'pending';
    } else if (skippedCount > 0) {
      suite.status = 'skipped';
    } else {
      suite.status = 'passed';
    }
    
    return suite.status;
  }

  /** Print only suites/specs that need attention */
  printProblemSuite(suite: TestSuite, indentLevel: number = 0): boolean {
    if (suite.id === this.rootSuite.id) return false;

    const indent = "  ".repeat(indentLevel);
    let hasProblems = false;

    // --- 1️⃣ Process children ---
    let childHasProblems = false;
    for (const child of suite.children) {
      if (this.printProblemSuite(child, indentLevel + 1)) {
        childHasProblems = true;
        hasProblems = true;
      }
    }

    // --- 2️⃣ Determine if this suite is a problem node ---
    const isProblemSuite = ["failed", "pending", "incomplete", "skipped"].includes(suite.status!);

    if (isProblemSuite || childHasProblems) {
      hasProblems = true;

      if (isProblemSuite) {
        const { symbol, color } = this.getSuiteSymbol(suite.status!);
        const specs = suite.specs;
        const specCount = specs.length;

        const failed = specs.filter(s => s.status === "failed").length;
        const pending = specs.filter(s => s.status === "pending").length;
        const incomplete = specs.filter(s => s.status === "incomplete").length;
        const skipped = specs.filter(s => s.status === "skipped").length;
        const passed = specs.filter(s => s.status === "passed").length;

        const statusParts: string[] = [];

        // Show status based on the suite's overall status
        switch (suite.status) {
          case "failed":
            if (failed > 0) statusParts.push(`${failed} failed`);
            if (passed > 0) statusParts.push(`${passed} passed`);
            if (pending > 0) statusParts.push(`${pending} pending`);
            if (incomplete > 0) statusParts.push(`${incomplete} incomplete`);
            if (skipped > 0) statusParts.push(`${skipped} skipped`);
            break;
          
          case "incomplete":
            if (incomplete > 0) statusParts.push(`${incomplete} incomplete`);
            if (passed > 0) statusParts.push(`${passed} passed`);
            if (failed > 0) statusParts.push(`${failed} failed`);
            if (pending > 0) statusParts.push(`${pending} pending`);
            break;
          
          case "pending":
            if (pending > 0) statusParts.push(`${pending} pending`);
            if (passed > 0) statusParts.push(`${passed} passed`);
            if (failed > 0) statusParts.push(`${failed} failed`);
            break;
          
          case "skipped":
            statusParts.push(`${specCount} skipped`);
            break;
          
          case "passed":
            statusParts.push(`${specCount} passed`);
            break;
        }

        // Add child suite count if applicable
        if (suite.children.length > 0) {
          statusParts.push(`${suite.children.length} child suite${suite.children.length !== 1 ? "s" : ""}`);
        }

        const details = statusParts.length ? this.colored("gray", ` (${statusParts.join(", ")})`) : "";
        // Use brighter color for incomplete suites
        const desc = suite.status === "incomplete" ? this.colored("yellow", suite.description) : suite.description;

        this.print(`${indent}${this.colored(color, symbol)} ${desc}${details}\n`);
      } else if (childHasProblems) {
        // Visual grouping for parent of problem children
        const hasNonSkippedChildProblems = suite.children.some(c =>
          ["failed", "pending", "incomplete"].includes(c.status!)
        );
        if (hasNonSkippedChildProblems) {
          this.print(`${indent}${this.colored("brightBlue", "↳")} ${this.colored("dim", suite.description)}\n`);
        }
      }
    }

    return hasProblems;
  }

  private getSuiteSymbol(status: 'failed' | 'pending' | 'skipped' | 'incomplete' | 'passed' | 'running'): { symbol: string; color: string } {
    switch (status) {
      case 'failed':
        return { symbol: '✕', color: 'brightRed' };
      case 'pending':
        return { symbol: '○', color: 'brightYellow' };
      case 'skipped':
        return { symbol: '⤼', color: 'gray' };
      case 'incomplete':
        return { symbol: '◷', color: 'cyan' };
      case 'passed':
        return { symbol: '✓', color: 'brightGreen' };
      default:
        return { symbol: '?', color: 'white' };
    }
  }

  private printBox(text: string, color: string) {
    const width = text.length + 4;
    const topBottom = '═'.repeat(width);

    logger.printlnRaw(`${this.colored(color, `  ╔${topBottom}╗`)}`);
    logger.printlnRaw(`${this.colored(color, `  ║  `)}${this.colored(['bold', color], text + `  ║`)}`);
    logger.printlnRaw(`${this.colored(color, `  ╚${topBottom}╝`)}`);
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

    const lineWidth = this.lineWidth;

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

  private colored(style: string | string[], text: string): string {
    const styles = Array.isArray(style) ? style : [style];
    const seq = styles.map(s => this.ansi[s] ?? '').join('');
    return `${seq}${text}${this.ansi.none}`;
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
    const cwdShort = this.truncateString(this.envInfo.cwd, 45, true);
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

    const shortUA = this.truncateString(userAgent.userAgent, 45);
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

    const lineWidth = this.lineWidth; // adjust or detect terminal width

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