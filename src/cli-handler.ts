import { ConfigManager } from "./config-manager";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { ViteJasmineRunner } from "./vite-jasmine-runner";

export function createViteJasmineRunner(config: ViteJasmineConfig): ViteJasmineRunner {
  return new ViteJasmineRunner(config);
}

export class CLIHandler {
  static async run(): Promise<void> {
    const args = process.argv.slice(2);
    const initOnly = args.includes('init');
    const headless = args.includes('--headless');
    const coverage = args.includes('--coverage');
    const browserIndex = args.findIndex(a => a === '--browser');
    let browserName: string = 'chrome';
    
    if (browserIndex !== -1 && browserIndex + 1 < args.length) {
      browserName = args[browserIndex + 1];
    }

    if (initOnly) {
      ConfigManager.initViteJasmineConfig();
      return;
    }

    try {
      let config = ConfigManager.loadViteJasmineBrowserConfig('ts-test-runner.json');
      config = { 
        ...config,
        headless: headless ? true : config.headless,
        coverage: coverage ? true : config.coverage,
        browser: browserIndex !== -1 && browserIndex + 1 < args.length ? browserName : config.browser
      };
      
      const runner = createViteJasmineRunner(config);
      await runner.start();
    } catch (error) {
      console.error('❌ Failed to start test runner:', error);
      process.exit(1);
    }
  }
}