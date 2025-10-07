import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import { fileURLToPath } from 'url';

export class HtmlGenerator {
  constructor(private config: ViteJasmineConfig) {}

  generateHtmlFile(): void {
    const htmlDir = this.config.outDir;
    if (!fs.existsSync(htmlDir)) {
      fs.mkdirSync(htmlDir, { recursive: true });
    }

    const builtFiles = fs.readdirSync(htmlDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    if (builtFiles.length === 0) {
      console.warn('⚠️  No JS files found for HTML generation.');
      return;
    }

    const sourceFiles = builtFiles.filter(f => !f.endsWith('.spec.js'));
    const specFiles = builtFiles.filter(f => f.endsWith('.spec.js'));
    const imports = [...sourceFiles, ...specFiles]
      .map(f => `import "./${f}";`)
      .join('\n        ');

    const __filename = norm(fileURLToPath(import.meta.url));
    const __dirname = norm(path.dirname(__filename));

    // Read favicon from assets and convert to Base64
    const faviconPath = path.resolve(__dirname, '../assets/favicon.ico');
    let faviconTag = '';
    if (fs.existsSync(faviconPath)) {
      const faviconData = fs.readFileSync(faviconPath);
      const faviconBase64 = faviconData.toString('base64');
      faviconTag = `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconBase64}">`;
    } else {
      console.warn(`⚠️  Favicon not found at ${faviconPath}, using default <link>`);
      faviconTag = `<link rel="icon" href="favicon.ico" type="image/x-icon" />`;
    }

    const htmlContent = this.generateHtmlTemplate(imports, faviconTag);
    const htmlPath = norm(path.join(htmlDir, 'index.html'));
    fs.writeFileSync(htmlPath, htmlContent);
    console.log('📄 Generated test page:', norm(path.relative(this.config.outDir, htmlPath)));
  }

  generateHtmlFileWithHmr(): void {
    const htmlDir = this.config.outDir;
    if (!fs.existsSync(htmlDir)) {
      fs.mkdirSync(htmlDir, { recursive: true });
    }

    const builtFiles = fs.readdirSync(htmlDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    if (builtFiles.length === 0) {
      console.warn('⚠️  No JS files found for HTML generation.');
      return;
    }

    const sourceFiles = builtFiles.filter(f => !f.endsWith('.spec.js'));
    const specFiles = builtFiles.filter(f => f.endsWith('.spec.js'));
    const imports = [...sourceFiles, ...specFiles]
      .map(f => `import "./${f}";`)
      .join('\n        ');

    const __filename = norm(fileURLToPath(import.meta.url));
    const __dirname = norm(path.dirname(__filename));

    // Read favicon from assets and convert to Base64
    const faviconPath = path.resolve(__dirname, '../assets/favicon.ico');
    let faviconTag = '';
    if (fs.existsSync(faviconPath)) {
      const faviconData = fs.readFileSync(faviconPath);
      const faviconBase64 = faviconData.toString('base64');
      faviconTag = `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${faviconBase64}">`;
    } else {
      console.warn(`⚠️  Favicon not found at ${faviconPath}, using default <link>`);
      faviconTag = `<link rel="icon" href="favicon.ico" type="image/x-icon" />`;
    }

    const htmlContent = this.generateHtmlTemplateWithHmr(imports, faviconTag);
    const htmlPath = norm(path.join(htmlDir, 'index.html'));
    fs.writeFileSync(htmlPath, htmlContent);
    console.log('📄 Generated HMR-enabled test page:', norm(path.relative(this.config.outDir, htmlPath)));
  }

  private generateHtmlTemplate(imports: string, faviconTag: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${faviconTag}
  <title>${this.config.htmlOptions?.title || 'Vite + Jasmine Tests'}</title>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css">
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot0.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot1.js"></script>
  <script>
    ${this.getWebSocketEventForwarderScript()}
    
    // Add the WebSocket forwarder as a reporter
    jasmine.getEnv().addReporter(new WebSocketEventForwarder());
  </script>
</head>
<body>
  <div class="jasmine_html-reporter"></div>
  <script type="module">
    ${imports}
  </script>
</body>
</html>`;
  }

  private generateHtmlTemplateWithHmr(imports: string, faviconTag: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${faviconTag}
  <title>${this.config.htmlOptions?.title || 'Vite + Jasmine Tests (HMR)'}</title>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css">
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot0.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot1.js"></script>
  <script>
    ${this.getWebSocketEventForwarderScript()}
    ${this.getHmrClientScript()}
    
    // Add the WebSocket forwarder as a reporter
    jasmine.getEnv().addReporter(new WebSocketEventForwarder());
  </script>
</head>
<body>
  <div class="jasmine_html-reporter"></div>
  <script type="module">
    ${imports}
  </script>
</body>
</html>`;
  }

  private getWebSocketEventForwarderScript(): string {
    return `
    function WebSocketEventForwarder() {
      this.ws = null;
      this.connected = false;
      this.messageQueue = [];
      
      this.connect = function() {
        try {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = protocol + '//' + window.location.host;
          console.log('Connecting to WebSocket:', wsUrl);
          
          this.ws = new WebSocket(wsUrl);
          
          this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            
            // Send any queued messages
            while (this.messageQueue.length > 0) {
              const queuedMessage = this.messageQueue.shift();
              this.send(queuedMessage);
            }
          };
          
          this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
          };
          
          this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.connected = false;
          };

          // Enable HMR message handling if in watch mode
          if (window.HMRClient) {
            this.ws.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data);
                if (message.type === 'hmr:update' || message.type === 'hmr:connected') {
                  window.HMRClient.handleMessage(message);
                }
              } catch (error) {
                console.error('Failed to handle WebSocket message:', error);
              }
            };
          }
        } catch (error) {
          console.error('Failed to create WebSocket:', error);
        }
      };
      
      this.send = function(message) {
        if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify(message));
            console.log('Sent WebSocket message:', message.type);
          } catch (error) {
            console.error('Failed to send WebSocket message:', error);
          }
        } else {
          // Queue message if not connected
          console.log('Queuing message (not connected):', message.type);
          this.messageQueue.push(message);
        }
      };
      
      this.jasmineStarted = function(suiteInfo) {
        console.log('Jasmine started with', suiteInfo.totalSpecsDefined, 'specs');
        this.connect();
        
        this.send({
          type: 'start',
          totalSpecs: suiteInfo.totalSpecsDefined,
          order: suiteInfo.order,
          timestamp: Date.now()
        });
      };
      
      this.specDone = function(result) {
        this.send({
          type: 'specDone',
          id: result.id,
          description: result.description,
          fullName: result.fullName,
          status: result.status,
          passedExpectations: result.passedExpectations || [],
          failedExpectations: result.failedExpectations || [],
          pendingReason: result.pendingReason || null,
          duration: result.duration || 0,
          timestamp: Date.now()
        });
      };
      
      this.jasmineDone = function(result) {
        console.log('Jasmine completed');
        const coverage = globalThis.__coverage__;
        this.send({
          type: 'done',
          totalTime: result.totalTime || 0,
          overallStatus: result.overallStatus || 'complete',
          incompleteReason: result.incompleteReason || null,
          order: result.order || null,
          timestamp: Date.now(),
          coverage: (coverage ? JSON.stringify(coverage) : null) 
        });
        
        // Set global flag for headless browser detection
        window.jasmineFinished = true;
        
        // Don't close WebSocket in HMR mode
        if (!window.HMRClient) {
          setTimeout(() => {
            if (this.ws) {
              this.ws.close();
            }
          }, 1000);
        }
      };
    }`;
  }

  private getHmrClientScript(): string {
    return `
    // HMR Client Runtime
    window.HMRClient = (function() {
      const moduleRegistry = new Map();
      let isUpdating = false;

      async function handleMessage(message) {
        if (message.type === 'hmr:connected') {
          console.log('🔥 HMR enabled on server');
          return;
        }

        if (message.type === 'hmr:update') {
          await handleHmrUpdate(message.data);
        }
      }

      async function handleHmrUpdate(update) {
        if (update.type === 'full-reload') {
          console.log('🔄 Full reload required');
          location.reload();
          return;
        }

        console.log('🔥 Hot updating:', update.path);

        try {
          // Create blob URL for the new module
          const blob = new Blob([update.content], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          
          // Import the new module with cache busting
          const newModule = await import(url + '?t=' + update.timestamp);
          
          // Store in registry
          moduleRegistry.set(update.path, newModule);
          
          // Revoke the blob URL
          URL.revokeObjectURL(url);

          // Re-run tests
          console.log('🧪 Re-running tests...');
          await rerunTests();
          
        } catch (error) {
          console.error('❌ HMR update failed:', error);
          
          // Send error back to server
          const wsForwarder = jasmine.getEnv().reporters_[0];
          if (wsForwarder && wsForwarder.ws) {
            wsForwarder.ws.send(JSON.stringify({ 
              type: 'hmr:error', 
              error: error.message 
            }));
          }
          
          console.log('🔄 Falling back to full reload');
          location.reload();
        }
      }

      async function rerunTests() {
        if (isUpdating) return;
        isUpdating = true;

        try {
          // Get Jasmine environment
          const jasmineEnv = jasmine.getEnv();
          
          // Store current reporters
          const reporters = jasmineEnv.reporters_;
          
          // Clear reporters temporarily
          jasmineEnv.clearReporters();
          
          // Clear previous results from DOM
          const reporterContainer = document.querySelector('.jasmine_html-reporter');
          if (reporterContainer) {
            reporterContainer.innerHTML = '';
          }
          
          // Re-add reporters
          reporters.forEach(reporter => jasmineEnv.addReporter(reporter));
          
          // Re-execute tests
          await jasmineEnv.execute();
          
        } catch (error) {
          console.error('❌ Failed to re-run tests:', error);
        } finally {
          isUpdating = false;
        }
      }

      return {
        handleMessage: handleMessage
      };
    })();`;
  }
}