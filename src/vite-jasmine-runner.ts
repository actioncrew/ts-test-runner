import * as fs from 'fs';
import * as path from 'path';
import { norm } from './utils';
import { glob } from 'glob';
import { EventEmitter } from 'events';
import { BrowserManager } from './browser-manager';
import { FileDiscoveryService } from './file-discovery-service';
import { HtmlGenerator } from './html-generator';
import { HttpServerManager } from './http-server-manager';
import { NodeTestRunner } from './node-test-runner';
import { NodeTestRunnerGenerator } from './node-test-runner-generator';
import { ViteConfigBuilder } from './vite-config-builder';
import { ViteJasmineConfig } from './vite-jasmine-config';
import { ConsoleReporter } from './console-reporter';
import { IstanbulInstrumenter } from './istanbul-instrumenter';
import { WebSocketManager } from './websocket-manager';
import { MultiReporter } from './multi-reporter';
import { CoverageReporter } from './coverage-reporter';
import { CoverageReportGenerator } from './coverage-report-generator';

const { build: viteBuild } = await import("vite");

export class ViteJasmineRunner extends EventEmitter {
  private config: ViteJasmineConfig;
  private fileDiscovery: FileDiscoveryService;
  private viteConfigBuilder: ViteConfigBuilder;
  private htmlGenerator: HtmlGenerator;
  private nodeRunnerGenerator: NodeTestRunnerGenerator;
  private browserManager: BrowserManager;
  private httpServerManager: HttpServerManager;
  private nodeTestRunner: NodeTestRunner;
  private webSocketManager: WebSocketManager | null = null;
  private multiReporter: MultiReporter;
  private instrumenter: IstanbulInstrumenter;

  constructor(config: ViteJasmineConfig) {
    super();
    
    // Normalize configuration
    const cwd = norm(process.cwd());
    this.config = {
      ...config,
      browser: config.browser ?? 'chrome',
      port: config.port ?? 8888,
      headless: config.headless ?? false,
      srcDir: norm(config.srcDir) ?? cwd,
      testDir: norm(config.testDir) ?? cwd,
      outDir: norm(config.outDir) ?? norm(path.join(cwd, 'dist/.vite-jasmine-build/')),
    };

    // Initialize services
    this.fileDiscovery = new FileDiscoveryService(this.config);
    this.viteConfigBuilder = new ViteConfigBuilder(this.config);
    this.htmlGenerator = new HtmlGenerator(this.config);
    this.nodeRunnerGenerator = new NodeTestRunnerGenerator(this.config);
    this.browserManager = new BrowserManager(this.config);
    this.httpServerManager = new HttpServerManager(this.config);
    this.nodeTestRunner = new NodeTestRunner(this.config);
    this.instrumenter = new IstanbulInstrumenter(this.config);
    this.multiReporter = new MultiReporter([new ConsoleReporter(), new CoverageReporter()]);
  }

  async preprocess(): Promise<void> {
    try {
      const { srcFiles, testFiles } = await this.fileDiscovery.discoverFiles();
      if (testFiles.length === 0) {
        throw new Error('No test files found');
      }

      const viteConfig = this.viteConfigBuilder.createViteConfig();
      const input: Record<string, string> = {};

      // Add source files
      srcFiles.forEach(file => {
        const relPath = path.relative(this.config.srcDir, file).replace(/\.(ts|js|mjs)$/, '');
        const key = relPath.replace(/[\/\\]/g, '_');
        input[key] = file;
      });

      // Add test files
      testFiles.forEach(file => {
        const relPath = path.relative(this.config.testDir, file).replace(/\.spec\.(ts|js|mjs)$/, '');
        const key = `${relPath.replace(/[\/\\]/g, '_')}.spec`;
        input[key] = file;
      });

      // Ensure output directory exists
      if (!fs.existsSync(this.config.outDir)) {
        fs.mkdirSync(this.config.outDir, { recursive: true });
      }

      viteConfig.build!.rollupOptions!.input = input;

      console.log(`📦 Building ${Object.keys(input).length} files...`);
      await viteBuild(viteConfig);

      // Pattern: all JS in outDir, skip specs
      const jsFiles = glob.sync(path.join(this.config.outDir, "**/*.js").replace(/\\/g, "/"))
        .filter(f => !/\.spec\.js$/i.test(f));

      for (const jsFile of jsFiles) {
        const instrumentedCode = await this.instrumenter.instrumentFile(jsFile);
        const outFile = path.join(this.config.outDir, path.relative(this.config.outDir, jsFile));
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, instrumentedCode, "utf-8");
      }
      
      // Only generate HTML if browser mode is not node
      if (!(this.config.headless && this.config.browser === 'node')) {
        this.htmlGenerator.generateHtmlFile();
      }

      // Generate test runner only for Node.js headless mode
      if (this.config.headless && this.config.browser === 'node') {
        this.nodeRunnerGenerator.generateTestRunner();
      }
    } catch (error) {
      console.error('❌ Preprocessing failed:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.webSocketManager) {
      await this.webSocketManager.cleanup();
      this.webSocketManager = null;
    }
    await this.httpServerManager.cleanup();
  }

  async start(): Promise<void> {
    console.log(`🚀 Starting Jasmine Test ${this.config.headless ? 'Runner (Headless)' : 'Server'}...`);

    // Ensure absolute paths
    this.config.outDir = norm(path.resolve(this.config.outDir));
    this.config.srcDir = norm(path.resolve(this.config.srcDir));
    this.config.testDir = norm(path.resolve(this.config.testDir));

    if (!fs.existsSync(this.config.outDir)) {
      fs.mkdirSync(this.config.outDir, { recursive: true });
    }

    try {
      await this.preprocess();
    } catch (error) {
      console.error('❌ Build failed:', error);
      process.exit(1);
    }

    // Handle headless browser mode
    if (this.config.headless && this.config.browser !== 'node') {
      await this.runHeadlessBrowserMode();
    }
    // Handle Node.js headless mode
    else if (this.config.headless && this.config.browser === 'node') {
      await this.runHeadlessNodeMode();
    }
    // Invalid configuration: headed Node.js mode
    else if (!this.config.headless && this.config.browser === 'node') {
      console.error('❌ Invalid configuration: Node.js runner cannot run in headed mode.');
      process.exit(1);
    }
    // Handle regular browser mode (headed)
    else {
      await this.runHeadedBrowserMode();
    }
  }

  private async runHeadlessBrowserMode(): Promise<void> {
    const server = await this.httpServerManager.startServer();
    await this.httpServerManager.waitForServerReady(`http://localhost:${this.config.port}/index.html`, 10000);

    this.webSocketManager = new WebSocketManager(server, this.multiReporter);

    let testSuccess = false;
    this.webSocketManager.on('testsCompleted', ({ success, coverage }) => {
      if (this.config.coverage) {
        if (!coverage) {
          console.warn('⚠️  No coverage information found. Make sure code is instrumented.');
          return;
        }
        new CoverageReportGenerator().generate(coverage);
      }
    });

    const browserType = await this.browserManager.checkBrowser(this.config.browser!);
    
    if (!browserType) {
      console.log('⚠️  Headless browser not available. Falling back to Node.js runner.');
      this.nodeRunnerGenerator.generateTestRunner();
      const success = await this.nodeTestRunner.runHeadlessTests();
      await this.cleanup();
      process.exit(success ? 0 : 1);
    }

    try {
      await this.browserManager.runHeadlessBrowserTests(browserType, this.config.port!);
      await this.cleanup();
      process.exit(testSuccess ? 0 : 1);
    } catch (error) {
      console.error('❌ Browser test execution failed:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  private async runHeadlessNodeMode(): Promise<void> {
    const success = await this.nodeTestRunner.runHeadlessTests();
    process.exit(success ? 0 : 1);
  }

  private async runHeadedBrowserMode(): Promise<void> {
    const server = await this.httpServerManager.startServer();
    let testsCompleted = false;
    this.webSocketManager = new WebSocketManager(server, this.multiReporter);
    
    console.log('📡 WebSocket server ready for real-time test reporting');
    console.log('⏹️  Press Ctrl+C to stop the server');
    
    this.webSocketManager.on('testsCompleted', ({ coverage }) => {
      testsCompleted = true;

      if (this.config.coverage) {
        if (!coverage) {
          console.warn('⚠️  No coverage information found. Make sure code is instrumented.');
          return;
        }
        new CoverageReportGenerator().generate(coverage);
      }
    });

    const onBrowserClose = async () => {
      if (!testsCompleted) {
        console.warn('\n\n🔄 Browser window closed prematurely');
      }
      await this.cleanup();
    };
    
    await this.browserManager.openBrowser(this.config.port!, onBrowserClose);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      if (!testsCompleted) {
        console.log('\n\n🛑 Tests aborted by user (Ctrl+C)');
      }
      await this.cleanup();
      process.exit(0);
    });
  }
}