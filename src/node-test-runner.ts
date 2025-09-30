import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { spawn } from 'child_process';
import { norm } from './utils';

export class NodeTestRunner {
  constructor(private config: ViteJasmineConfig) {}

  async runHeadlessTests(): Promise<boolean> {
    return new Promise((resolve) => {
      const testRunnerPath = norm(path.join(this.config.outDir, 'test-runner.js'));

      if (!fs.existsSync(testRunnerPath)) {
        console.error('❌ Test runner not found. Build may have failed.');
        resolve(false);
        return;
      }

      const child = spawn('node', [testRunnerPath], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test'
        }
      });

      let interrupted = false;
      const sigintHandler = () => {
        interrupted = true;
        console.log('\n\n🛑 Tests aborted by user (Ctrl+C)');
        child.kill('SIGINT');
      };

      process.once('SIGINT', sigintHandler);

      child.on('close', (code) => {
        process.removeListener('SIGINT', sigintHandler);
        resolve(interrupted ? false : code === 0);
      });

      child.on('error', (error) => {
        process.removeListener('SIGINT', sigintHandler);
        console.error('❌ Failed to run headless tests:', error);
        resolve(false);
      });
    });
  }
}