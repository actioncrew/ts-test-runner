import util from 'util';

export class ConsoleReporter {
  private print: (...args: any[]) => void;
  private showColors: boolean;
  private specCount: number;
  private executableSpecCount: number;
  private failureCount: number;
  private failedSpecs: any[];
  private pendingSpecs: any[];
  private ansi: Record<string, string>;

  constructor() {
    this.print = (...args) => process.stdout.write(util.format(...args));
    this.showColors = true;
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.ansi = { 
      green: '\x1B[32m', 
      red: '\x1B[31m', 
      yellow: '\x1B[33m', 
      none: '\x1B[0m' 
    };
  }

  jasmineStarted(options: any) {
    this.specCount = 0;
    this.executableSpecCount = 0;
    this.failureCount = 0;
    this.failedSpecs = [];
    this.pendingSpecs = [];
    this.print('🏃 Executing tests...\n\n');
  }

  specDone(result: any) {
    this.specCount++;
    switch (result.status) {
      case 'passed': 
        this.executableSpecCount++; 
        this.print(this.colored('green', '.')); 
        break;
      case 'failed': 
        this.failureCount++; 
        this.failedSpecs.push(result); 
        this.executableSpecCount++; 
        this.print(this.colored('red', 'F')); 
        break;
      case 'pending': 
        this.pendingSpecs.push(result); 
        this.executableSpecCount++; 
        this.print(this.colored('yellow', '*')); 
        break;
    }
  }

  suiteStarted() {}
  specStarted() {}
  suiteDone() {}

  jasmineDone(result: any) {
    const totalTime = result ? result.totalTime / 1000 : 0;
    const failedSpecsPresent = this.failedSpecs.length > 0;
    const pendingSpecsPresent = this.pendingSpecs.length > 0;

    // Display failures
    if (failedSpecsPresent) {
      this.print('\n\n❌ Failures:\n\n');
      this.failedSpecs.forEach((spec, i) => {
        this.print(`  ${i + 1}) ${spec.fullName}\n`);
        if (spec.failedExpectations?.length > 0) {
          spec.failedExpectations.forEach((expectation: any) => {
            this.print(`     ${this.colored('red', expectation.message)}\n`);
          });
        }
      });
    }

    // Display pending specs
    if (pendingSpecsPresent) {
      this.print(`${failedSpecsPresent ? '\n' : '\n\n'}⏸️  Pending specs:\n\n`);
      this.pendingSpecs.forEach((spec, i) => {
        this.print(`  ${i + 1}) ${spec.fullName}\n`);
        if (spec.pendingReason) {
          this.print(`     ${this.colored('yellow', spec.pendingReason)}\n`);
        }
      });
    }

    // Display summary
    this.print(`${failedSpecsPresent || pendingSpecsPresent ? '\n' : '\n\n'}📊 Summary: `);
    const specsText = this.executableSpecCount + ' ' + this.plural('spec', this.executableSpecCount);
    const failuresText = this.failureCount + ' ' + this.plural('failure', this.failureCount);
    const pendingText = this.pendingSpecs.length + ' ' + this.plural('pending spec', this.pendingSpecs.length);
    
    this.print(specsText);
    if (this.failureCount > 0) this.print(', ' + this.colored('red', failuresText));
    else this.print(', ' + failuresText);
    if (this.pendingSpecs.length > 0) this.print(', ' + this.colored('yellow', pendingText));
    
    this.print('\n');
    this.print('⏱️  Finished in ' + totalTime.toFixed(3) + ' ' + this.plural('second', totalTime));
    this.print('\n\n');

    if (result.overallStatus === 'passed') {
      if (this.pendingSpecs.length === 0) {
        this.print(this.colored('green', '✅ All specs passed!\n'));
      } else {
        this.print(
          this.colored('green', '✅ All specs passed!\n') +
          this.colored('yellow', `(with ${this.pendingSpecs.length} pending)\n`)
        );
      }
    } else if (result.overallStatus === 'failed') {
      this.print(
        this.colored('red', `❌ ${this.failureCount} ${this.plural('spec', this.failureCount)} failed\n`)
      );
    } else if (result.overallStatus === 'incomplete') {
      this.print(this.colored('red', '⚠️  Tests could not be run (incomplete)\n'));
    } else {
      this.print(this.colored('red', `⚠️  Unknown test status: ${result.overallStatus}\n`));
    }

    return this.failureCount;
  }

  testsAborted(message?: string) {
    this.print(this.colored('red', `\n❌ Tests aborted${message ? ': ' + message : ''}\n`));
  }

  private colored(color: string, str: string): string {
    return this.showColors ? this.ansi[color] + str + this.ansi.none : str;
  }

  private plural(str: string, count: number): string {
    return count === 1 ? str : str + 's';
  }
}