import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import JSONCleaner from './json-cleaner';
import { logger } from './console-repl';

export class ConfigManager {
  static ensureConfigExists(configPath?: string): ViteJasmineConfig {
    const jsonPath = norm(configPath || path.resolve(process.cwd(), 'ts-test-runner.json'));
    const cleaner = new JSONCleaner()
    if (fs.existsSync(jsonPath)) {
      try {
        return cleaner.parse(fs.readFileSync(jsonPath, 'utf-8'));
      } catch (error) {
        logger.error(`❌ Failed to parse existing ts-test-runner.json ${error}`);
        return {} as ViteJasmineConfig;
      }
    }

    // Create default config if it does not exist
    const defaultConfig = this.createDefaultConfig();
    
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(defaultConfig, null, 2));
      logger.println(`🆕 Created default test runner config at ${jsonPath}`);
    } catch (error) {
      logger.error(`❌ Failed to create default ts-test-runner.json ${error}`);
    }

    return defaultConfig;
  }

  static createDefaultConfig(): ViteJasmineConfig {
    const cwd = norm(process.cwd());
    return {
      srcDir: cwd,
      testDir: cwd,
      outDir: norm(path.join(cwd, 'dist/.vite-jasmine-build/')),
      browser: 'chrome',
      headless: false,
      port: 8888,
      viteBuildOptions: {
        target: 'es2022',
        sourcemap: true,
        minify: false,
        preserveModules: true,
        preserveModulesRoot: cwd
      },
      jasmineConfig: {
        env: { stopSpecOnExpectationFailure: false, random: true, timeout: 120000 },
        browser: { name: 'chrome', headless: false },
        reporter: 'console'
      },
      htmlOptions: {
        title: 'Jasmine Tests Runner',
        includeSourceScripts: true,
        includeSpecScripts: true
      }
    };
  }

  static initViteJasmineConfig(configPath?: string): void {
    const jsonPath = norm(configPath || path.resolve(process.cwd(), 'ts-test-runner.json'));

    if (fs.existsSync(jsonPath)) {
      logger.println(`⚠️  Config already exists at ${jsonPath}`);
      return;
    }

    const defaultConfig = this.createDefaultConfig();
    fs.writeFileSync(jsonPath, JSON.stringify(defaultConfig, null, 2));
    logger.println(`✅ Generated default Vite Jasmine config at ${jsonPath}`);
  }

  static loadViteJasmineBrowserConfig(configPath?: string): ViteJasmineConfig {
    return this.ensureConfigExists(configPath);
  }
}
