import fs from 'fs';
import path from 'path';
import { Reporter } from './compound-reporter';
import { CoverageReportGenerator } from './coverage-report-generator';
import { logger } from './console-repl';

export interface CoverageReporterOptions {
  coverage: boolean;
}

export class CoverageReporter implements Reporter {
  
  constructor(private options?: CoverageReporterOptions) {
  }

  // Jasmine Reporter hooks (optional for coverage)
  jasmineStarted() {}
  suiteStarted() {}
  specStarted() {}
  specDone() {}
  suiteDone() {}

  jasmineDone() {
    // Collect coverage from globalThis.__coverage__
    const coverage = (globalThis as any).__coverage__;

    if (this.options?.coverage) {
      if (!coverage) {
        logger.println('⚠️  No coverage information found. Make sure code is instrumented.');
        return;
      }
      new CoverageReportGenerator().generate(coverage);
    }
  }
}
