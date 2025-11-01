// host-adapter.ts
import { ChildProcess } from 'node:child_process';
import { ConsoleReporter } from './console-reporter';
import { logger } from './console-repl';

export class HostAdapter {
  constructor(private child: ChildProcess, private reporter: ConsoleReporter) {
    this.bindListeners();
  }

  private bindListeners() {
    this.child.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      const { type, data } = msg;

      switch (type) {
        case 'userAgent':
          this.reporter.userAgent(data);
          break;
        case 'jasmineStarted':
          this.reporter.jasmineStarted(data);
          break;
        case 'suiteStarted':
          this.reporter.suiteStarted(data);
          break;
        case 'specStarted':
          this.reporter.specStarted(data);
          break;
        case 'specDone':
          this.reporter.specDone(data);
          break;
        case 'suiteDone':
          this.reporter.suiteDone(data);
          break;
        case 'jasmineDone':
          this.reporter.jasmineDone(data);
          break;
        case 'testsAborted':
          this.reporter.testsAborted(data?.message);
          break;
        case 'ready':
          logger.println('Child test process ready');
          break;
        default:
          logger.println(`⚠ Unknown message type: ${type}`);
      }
    });

    this.child.on('exit', (code) => {
      if (code !== 0)
        this.reporter.testsAborted(`Child exited with code ${code}`);
    });

    this.child.on('error', (err) => {
      this.reporter.testsAborted(`Child process error: ${err.message}`);
    });
  }
}
