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
          console.warn(`⚠️  Unknown browser "${browserName}", falling back to Node.js mode`);
          return null;
      }

      return browser;
    } catch (err: any) {
      if (err.code === 'MODULE_NOT_FOUND') {
        console.log(`ℹ️ Playwright not installed. Browser "${browserName}" not available.`);
        console.log(`💡 Tip: Install Playwright to enable browser testing:\n   npm install playwright`);
      } else {
        console.error(`❌ Browser execution failed for "${browserName}": ${err.message}`);
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
        if (type === 'error') console.error('BROWSER ERROR:', text);
        else if (type === 'warn') console.warn('BROWSER WARN:', text);
      }
    });

    page.on('pageerror', (error: any) => console.error('❌ Page error:', error.message));
    page.on('requestfailed', (request: any) => console.error('❌ Request failed:', request.url(), request.failure()?.errorText));

    console.log('🌐 Navigating to test page...');
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
        console.log('\n\n🛑 Tests aborted by user (Ctrl+C)');
        await browser.close();
        return false;
      }
      console.error('❌ Test execution failed:', error);
      await browser.close();
      throw error;
    } finally {
      process.removeListener('SIGINT', sigintHandler);
    }
  }

  async openBrowser(port: number, onBrowserClose?: () => Promise<void>): Promise<void> {
    const browserName = this.config.browser || 'chrome';
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
          console.warn(`⚠️  Unknown browser "${browserName}", using Chrome instead`);
          browserType = playwright.chromium;
      }
      
      if (!browserType) {
        console.warn(`❌ Browser "${browserName}" is not installed.`);
        console.log(`💡 Tip: Install it by running: npx playwright install ${browserName.toLowerCase()}`);
        return;
      }
      
      console.log(`🌐 Opening ${browserName} browser...`);
      const browser = await browserType.launch({ 
        headless: this.config.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await browser.newPage();
      await page.goto(url);
      
      console.log(`✅ Browser opened successfully: ${url}`);
      
      // Handle browser close event
      page.on('close', async () => {
        console.log('🔄 Browser window closed');
        if (onBrowserClose) {
          await onBrowserClose();
        }
        process.exit(0);
      });
      
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.log(`ℹ️ Playwright not installed. Please open browser manually: ${url}`);
        console.log(`💡 Tip: Install Playwright to enable automatic browser opening:\n   npm install playwright`);
      } else {
        console.error(`❌ Failed to open browser: ${error.message}`);
        console.log(`💡 Please open browser manually: ${url}`);
      }
    }
  }
}