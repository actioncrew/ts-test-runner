import { logger } from "./console-repl";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import type * as PlayWright from 'playwright';

export class BrowserManager {
  private playwright: typeof PlayWright | null = null;

  constructor(private config: ViteJasmineConfig) {}

  private getPlaywright(): typeof PlayWright {
    if (!this.playwright) {
      this.playwright = require('playwright');
    }
    return this.playwright!;
  }

  async checkBrowser(browserName: string): Promise<any | null> {
    try {
      const playwright = this.getPlaywright();
      
      let browser: any = null;
      switch (browserName.toLowerCase()) {
        case 'chromium':
        case 'chrome':
          browser = playwright.chromium;
          break;
        case 'firefox':
          browser = playwright.firefox;
          break;
        case 'webkit':
        case 'safari':
          browser = playwright.webkit;
          break;
        default:
          logger.println(`⚠️  Unknown browser "${browserName}", falling back to Node.js mode`);
          return null;
      }

      return browser;
    } catch (err: any) {
      if (err.code === 'MODULE_NOT_FOUND') {
        logger.println(`ℹ️ Playwright not installed. Browser "${browserName}" not available.`);
        logger.println(`💡 Tip: Install Playwright to enable browser testing:\n   npm install playwright`);
      } else {
        logger.error(`❌ Browser execution failed for "${browserName}": ${err.message}`);
      }
      return null;
    }
  }

  async runHeadlessBrowserTests(browserType: any, port: number): Promise<boolean> {
    const browser = await browserType.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    page.setDefaultTimeout(0);

    let interrupted = false;
    const sigintHandler = () => { interrupted = true; };
    process.once('SIGINT', sigintHandler);

    // Unified console and error logging
    page.on('console', (msg: any) => {
      const text = msg.text();
      const type = msg.type();
      if (text.match(/error|failed/i)) {
        if (type === 'error') logger.error(`BROWSER ERROR: ${text}`);
        else if (type === 'warn') logger.println(`BROWSER WARN: ${text}`);
      }
    });

    page.on('pageerror', (error: any) => logger.error(`❌ Page error: ${error.message}`));
    page.on('requestfailed', (request: any) => logger.error(`❌ Request failed: ${request.url()}, ${request.failure()?.errorText}`));

    logger.println('🌐 Navigating to test page...');
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'networkidle0', timeout: 120000 });

    try {
      await page.waitForFunction(() => (window as any).jasmineFinished === true, {
        timeout: this.config.jasmineConfig?.env?.timeout ?? 120000
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      await browser.close();
      
      return true; // Success determined by WebSocket messages
    } catch (error) {
      if (interrupted) {
        logger.println('\n\n🛑 Tests aborted by user (Ctrl+C)');
        await browser.close();
        return false;
      }
      logger.error(`❌ Test execution failed: ${error}`);
      await browser.close();
      throw error;
    } finally {
      process.removeListener('SIGINT', sigintHandler);
    }
  }

  async openBrowser(port: number, onBrowserClose?: () => Promise<void>): Promise<void> {
    let browserName = this.config.browser || 'chrome';
    const url = `http://localhost:${port}/index.html`;
    
    try {
      const playwright = this.getPlaywright();
      let browserType: any;
      
      switch (browserName.toLowerCase()) {
        case 'chrome':
        case 'chromium':
          browserType = playwright.chromium;
          break;
        case 'firefox':
          browserType = playwright.firefox;
          break;
        case 'webkit':
        case 'safari':
          browserType = playwright.webkit;
          break;
        default:
          logger.println(`⚠️  Unknown browser "${browserName}", using Chrome instead`);
          browserType = playwright.chromium;
          browserName = 'chrome';
      }
      
      if (!browserType) {
        logger.println(`❌ Browser "${browserName}" is not installed.`);
        logger.println(`💡 Tip: Install it by running: npx playwright install ${browserName.toLowerCase()}`);
        return;
      }
      
      logger.println(`🌐 Opening ${browserName} browser...`);
      const browser = await browserType.launch({ 
        headless: this.config.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.goto(url);
      
      // Handle browser close event
      page.on('close', async () => {
        if (onBrowserClose) {
          await onBrowserClose();
        }
        process.exit(0);
      });
      
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.println(`ℹ️ Playwright not installed. Please open browser manually: ${url}`);
        logger.println(`💡 Tip: Install Playwright to enable automatic browser opening:\n   npm install playwright`);
      } else {
        logger.error(`❌ Failed to open browser: ${error.message}`);
        logger.println(`💡 Please open browser manually: ${url}`);
      }
    }
  }
}