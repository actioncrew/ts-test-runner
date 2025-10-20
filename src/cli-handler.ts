import { ConfigManager } from "./config-manager";
import { logger } from "./console-repl";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { ViteJasmineRunner } from "./vite-jasmine-runner";

export function createViteJasmineRunner(config: ViteJasmineConfig): ViteJasmineRunner {
  return new ViteJasmineRunner(config);
}

export class CLIHandler {
  static async run(): Promise<void> {
    const args = process.argv.slice(2);
    const initOnly = args.includes('init');
    const watch = args.includes('--watch');
    const headless = args.includes('--headless');
    const coverage = args.includes('--coverage');
    const browserIndex = args.findIndex(a => a === '--browser');
    const hasBrowserArg = browserIndex !== -1;
    let browserName: string = 'chrome';
    
    if (hasBrowserArg && browserIndex + 1 < args.length) {
      browserName = args[browserIndex + 1];
    }

    // Handle init
    if (initOnly) {
      ConfigManager.initViteJasmineConfig();
      return;
    }

    // Enforce exclusivity of --watch
    if (watch) {
      const invalidFlags: string[] = [];
      if (headless) invalidFlags.push('--headless');
      if (coverage) invalidFlags.push('--coverage');
      
      if (invalidFlags.length > 0) {
        logger.error(`❌ The --watch flag cannot be used with: ${invalidFlags.join(', ')}`);
        process.exit(1);
      }
    }

    try {
      let config = ConfigManager.loadViteJasmineBrowserConfig('ts-test-runner.json');
      config = {
        ...config,
        headless: headless ? true : (config.headless || false),
        coverage: coverage ? true : (config.coverage || false),
        browser: hasBrowserArg ? browserName : (config.browser || 'chrome'),
        watch: watch ? true : (config.watch || false)
      };

      const runner = createViteJasmineRunner(config);

      if (watch) {
        await runner.watch();
      } else {
        await runner.start();
      }
    } catch (error) {
      logger.error(`❌ Failed to start test runner: ${error}`);
      process.exit(1);
    }
  }
}
