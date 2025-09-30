import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { fileURLToPath } from 'url';
import { norm } from './utils';

export class NodeTestRunnerGenerator {
  constructor(private config: ViteJasmineConfig) {}

  generateTestRunner(): void {
    const outDir = this.config.outDir;
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const builtFiles = fs.readdirSync(outDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    if (builtFiles.length === 0) {
      console.warn('⚠️  No JS files found for test runner generation.');
      return;
    }

    const imports = builtFiles
      .map(f => `    await import('./${f}');`)
      .join('\n');

    const runnerContent = this.generateRunnerTemplate(imports);
    fs.writeFileSync(norm(path.join(outDir, 'test-runner.js')), runnerContent);
    console.log('🤖 Generated headless test runner:', norm(path.join(outDir, 'test-runner.js')));
  }

  private generateRunnerTemplate(imports: string): string {
    return `// Auto-generated headless Jasmine test runner
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const __filename = "${fileURLToPath(import.meta.url).replace(/\\/g, '/')}";
const __dirname = path.dirname(__filename).replace(/\\\\/g, '/');

// Global error handlers
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled Rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Import and execute specs
(async function() {
  const { MultiReporter, ConsoleReporter, CoverageReporter } = await import(pathToFileURL(path.join(__dirname, '../lib/index.js')).href);
  const jasmineCore = await import(pathToFileURL(path.join(__dirname, '../node_modules/jasmine-core/lib/jasmine-core/jasmine.js')).href);

  // Initialize Jasmine
  const jasmineRequire = jasmineCore.default;
  const jasmine = jasmineRequire.core(jasmineRequire);
  const env = jasmine.getEnv();
  Object.assign(globalThis, jasmineRequire.interface(jasmine, env));
  globalThis.jasmine = jasmine;
  
  // Configure environment
  env.configure({
    random: ${this.config.jasmineConfig?.env?.random ?? true},
    stopOnSpecFailure: ${this.config.jasmineConfig?.env?.stopSpecOnExpectationFailure ?? false}
  });

  env.clearReporters();
  const reporter = new MultiReporter([new ConsoleReporter(), new CoverageReporter({ coverage: ${this.config.coverage} })]);
  env.addReporter(reporter);

  try {
${imports}
    await env.execute();
  } catch (error) {
    console.error('❌ Error during test execution:', error);
    setImmediate(() => process.exit(1));
  } finally {
    // get failure count from the reporter
    const failures = reporter.failureCount || 0;;

    setImmediate(() => process.exit(failures === 0 ? 0 : 1));
  }
})();
`;
  }
}
