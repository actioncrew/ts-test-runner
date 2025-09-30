import fs from 'fs';
import path from 'path';
import { Reporter } from './multi-reporter';
import { CoverageReportGenerator } from './coverage-report-generator';

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
        console.warn('⚠️  No coverage information found. Make sure code is instrumented.');
        return;
      }
      new CoverageReportGenerator().generate(coverage);
    }
  }

  testsAborted(message?: string) {
    console.warn('⚠️  Tests aborted. Coverage may be incomplete.', message ?? '');
  }
}
