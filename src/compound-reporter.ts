export interface Reporter {
  jasmineStarted(suiteInfo: any): void;
  suiteStarted(result: any): void;
  specStarted(result: any): void;
  specDone(result: any): void;
  suiteDone(result: any): void;
  jasmineDone(result: any): void;
}

export class CompoundReporter {
  private reporters: Reporter[];

  constructor(reporters: Reporter[] = []) {
    this.reporters = reporters;
  }

  addReporter(reporter: Reporter) {
    this.reporters.push(reporter);
  }

  userAgent(agentInfo: any) {
    this.reporters.forEach(r => (r as any)?.userAgent?.(agentInfo));  
  }

  jasmineStarted(suiteInfo: any) {
    this.reporters.forEach(r => r.jasmineStarted?.(suiteInfo));
  }

  suiteStarted(result: any) {
    this.reporters.forEach(r => r.suiteStarted?.(result));
  }

  specStarted(result: any) {
    this.reporters.forEach(r => r.specStarted?.(result));
  }

  specDone(result: any) {
    this.reporters.forEach(r => r.specDone?.(result));
  }

  suiteDone(result: any) {
    this.reporters.forEach(r => r.suiteDone?.(result));
  }

  jasmineDone(result: any) {
    this.reporters.forEach(r => r.jasmineDone?.(result));
  }
}
