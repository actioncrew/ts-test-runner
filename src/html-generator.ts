import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import { fileURLToPath } from 'url';
import { FileDiscoveryService } from './file-discovery-service';

export class HtmlGenerator {
  constructor(private fileDiscovery: FileDiscoveryService, private config: ViteJasmineConfig) { }

  async generateHtmlFile() {
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

  async generateHtmlFileWithHmr() {
    const htmlDir = this.config.outDir;
    if (!fs.existsSync(htmlDir)) {
      fs.mkdirSync(htmlDir, { recursive: true });
    }

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

    const htmlContent = await this.generateHtmlTemplateWithHmr(faviconTag);
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
  <title>${this.config.htmlOptions?.title || 'Jasmine Tests Runner'}</title>
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

  private async generateHtmlTemplateWithHmr(faviconTag: string) {    
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${faviconTag}
  <title>${this.config.htmlOptions?.title || "Jasmine Tests Runner (HMR)"}</title>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css">
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css" />
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>

  <script>
(function patchJasmineBeforeBoot() {
  if (!window.jasmineRequire) {
    return setTimeout(patchJasmineBeforeBoot, 10);
  }

  const j$ = jasmineRequire.core(jasmineRequire);

  // Save originals
  const OriginalSuiteFactory = jasmineRequire.Suite || j$.Suite || null;
  const OriginalEnvFactory = jasmineRequire.Env || j$.Env || null;

  // Helper: make sure we reference the right factory object to overwrite.
  const root = window.jasmineRequire || jasmineRequire;

  // Patch Suite factory so returned Suite class sets metadata.__suite
  root.Suite = function(j$local) {
    // Get the original Suite class (as the factory would normally return)
    const OriginalSuite = (OriginalSuiteFactory ? OriginalSuiteFactory(j$local) : j$.localSuite) || j$.Suite;

    // Subclass to attach backref
    return class PatchedSuite extends OriginalSuite {
      constructor(attrs) {
        super(attrs);
        try {
          // If metadata exists, keep a back-reference
          if (this.metadata && typeof this.metadata === 'object' && !this.metadata.__suite) {
            Object.defineProperty(this.metadata, '__suite', {
              value: this,
              enumerable: false,
              configurable: true,
              writable: false
            });
          }
        } catch (err) {
          // ignore; patch must not break Jasmine
        }
      }
    };
  };

  // Patch Env factory to capture topSuite reference as soon as Env creates it
  if (OriginalEnvFactory) {
    root.Env = function(j$local) {
      const OriginalEnv = OriginalEnvFactory(j$local);
      return class PatchedEnv extends OriginalEnv {
        constructor(attrs) {
          super(attrs);
          try {
            // env.topSuite is usually created in the Env constructor
            if (this.topSuite) {
              // store reference globally if you need it elsewhere
              window.__jasmine_real_topSuite = this.topSuite;
              // Also ensure metadata backrefs for the topSuite and its children (optional)
              attachMetadataBackrefsRecursive(this.topSuite);
            }
          } catch (err) {}
        }
      };
    };
  }

  // optionally walk suite tree and attach metadata.__suite to every suite encountered
  function attachMetadataBackrefsRecursive(suite) {
    try {
      if (suite && suite.metadata && !suite.metadata.__suite) {
        Object.defineProperty(suite.metadata, '__suite', {
          value: suite,
          enumerable: false,
          configurable: true,
          writable: false
        });
      }
      if (Array.isArray(suite.children)) {
        for (const ch of suite.children) attachMetadataBackrefsRecursive(ch);
      }
    } catch (e) {}
  }

  // Wait for runner to be ready, then load all spec files
  async function loadSpecs(srcFiles, specFiles) {
    // Wait for HMRClient
    while (!window.HMRClient) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log('📦 Loading spec files dynamically...');
    
    // Load source files first
    for (const file of srcFiles) {
      await import('/' + file);
    }
    
    // Then load spec files with file path tracking
    for (const file of specFiles) {
      const module = await import('/' + file);
      
      // Attach file path to suites after import
      if (window.HMRClient && window.HMRClient.attachFilePathToSuites) {
        await window.HMRClient.attachFilePathToSuites(file, module);
      }
    }
    
    console.log('✅ All specs loaded and tagged with file paths');
  }

  const script = document.createElement('script');
  script.src = '/node_modules/jasmine-core/lib/jasmine-core/boot0.js';
  script.onload = () => {
    
    ${this.getWebSocketEventForwarderScript()}
    ${this.getHmrClientScript()}
    ${this.getRuntimeHelpersScript()}

    // Add the WebSocket forwarder as a reporter
    const forwarder = new WebSocketEventForwarder();
    forwarder.connect();
    jasmine.getEnv().addReporter(forwarder);  
  };
  document.head.appendChild(script);
})();
</script>
</head>
<body>

  <div class="jasmine_html-reporter"></div>
</body>
</html>`;
  }

  private getWebSocketEventForwarderScript(): string {
    return `
function WebSocketEventForwarder() {
  this.ws = null;
  this.connected = false;
  this.messageQueue = [];

  const self = this;

  // Establish WebSocket connection
  this.connect = function() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host;

    self.ws = new WebSocket(wsUrl);

    self.ws.onopen = () => {
      self.connected = true;
      console.log('WebSocket connected to', wsUrl);

      // Flush queued messages
      while (self.messageQueue.length > 0) {
        const msg = self.messageQueue.shift();
        self.send(msg);
      }
    };

    self.ws.onclose = () => {
      self.connected = false;
      console.log('WebSocket disconnected');
      // Reconnect after a short delay
      setTimeout(() => self.connect(), 1000);
    };

    self.ws.onerror = (err) => {
      self.connected = false;
      console.error('WebSocket error:', err);
    };

    self.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        // Forward HMR messages to HMRClient
        if (window.HMRClient && (message.type === 'hmr:connected' || message.type === 'hmr:update')) {
          await window.HMRClient.handleMessage(message);
        }
      } catch (err) {
        console.error('Failed to handle WebSocket message:', err);
      }
    };
  };

  // Send message immediately or queue if not connected
  this.send = function(msg) {
    if (self.connected && self.ws && self.ws.readyState === WebSocket.OPEN) {
      try {
        self.ws.send(JSON.stringify(msg));
      } catch (err) {
        console.error('Failed to send WebSocket message:', err);
      }
    } else {
      self.messageQueue.push(msg);
    }
  };

  // Jasmine reporter hooks
  this.jasmineStarted = function(suiteInfo) {
    self.send({
      type: 'start',
      totalSpecs: suiteInfo.totalSpecsDefined,
      order: suiteInfo.order,
      timestamp: Date.now()
    });
  };

  this.specDone = function(result) {
    self.send({
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
    const coverage = globalThis.__coverage__;

    self.send({
      type: 'done',
      totalTime: result.totalTime || 0,
      overallStatus: result.overallStatus || 'complete',
      incompleteReason: result.incompleteReason || null,
      order: result.order || null,
      timestamp: Date.now(),
      coverage: coverage ? JSON.stringify(coverage) : null
    });

    window.jasmineFinished = true;

    // Only close WebSocket if HMR is not present
    if (!window.HMRClient) {
      setTimeout(() => {
        if (self.ws) self.ws.close();
      }, 1000);
    }
  };
}
  `;
  }

  private getHmrClientScript(): string {
    return `
// HMR Client Runtime
window.HMRClient = (function() {
  const moduleRegistry = new Map();
  const j$ = window.jasmine;
  if (!j$ || !j$.getEnv) {
    console.warn('❌ Jasmine not found. HMR will not work.');
    return { handleMessage: async () => {} };
  }

  const env = j$.getEnv();

  // Helper: set non-enumerable _filePath
  function setFilePath(obj, filePath) {
    if (!obj) return;
    try {
      Object.defineProperty(obj, '_filePath', {
        value: filePath,
        enumerable: false,
        configurable: true,
        writable: true
      });
    } catch (e) {
      obj._filePath = filePath;
    }
  }

  // Attach file path to newly created suites recursively
  async function attachFilePathToSuites(filePath, moduleExports) {
    const topSuite = env.topSuite().__suite;
    if (!topSuite) return;


    // Walk all suites recursively and attach _filePath if missing
    function tagSuites(suite) {
        if (!suite) return;

        // Attach _filePath if not set
        if (!suite._filePath) {
            setFilePath(suite, filePath);
        }

        // Ensure metadata backref
        if (suite.metadata && !suite.metadata.__suite) {
            try {
                Object.defineProperty(suite.metadata, '__suite', {
                    value: suite,
                    enumerable: false,
                    configurable: true,
                    writable: false
                });
            } catch {}
        }

        // Recurse children
        const children = suite.children || [];
        for (const ch of children) {
            const real = ch;
            tagSuites(real);
        }
    }

    tagSuites(topSuite);
  }

  function detachFilePathSuites(filePath) {
    const topSuite = env.topSuite().__suite;
    if (!topSuite) return;

    function cleanSuite(suite) {
      if (!suite || !Array.isArray(suite.children)) return;

      const keep = [];

      for (const childWrapper of suite.children) {
        if (!childWrapper) continue;

        const child = childWrapper;

        // If this child matches the filePath, skip it entirely
        if (child._filePath === filePath) {
          // Don't recursively clean - we're removing this entire branch
          continue;
        }

        // If this child is a suite, recursively clean its children
        if (child.children && Array.isArray(child.children)) {
          cleanSuite(child);
        }

        // Keep this child (it doesn't match the filePath)
        keep.push(childWrapper);
      }

      // Replace children array
      if (suite.removeChildren && suite.addChild) {
        // Use Jasmine's API if available
        suite.removeChildren();
        keep.forEach(item => suite.addChild(item));
      } else {
        // Fallback: direct array replacement
        suite.children = keep;
      }

      // Also clean specs array if it exists
      if (Array.isArray(suite.specs)) {
        suite.specs = suite.specs.filter(spec => spec._filePath !== filePath);
      }
    }

    // Clean starting from top suite's real instance
    cleanSuite(topSuite);
    
    console.log(\`🧹 Detached all suites/specs with _filePath: \${filePath}\`);
  }

  // Hot update a single module
  async function hotUpdateSpec(filePath, moduleExports) {
    detachFilePathSuites(filePath);
    await attachFilePathToSuites(filePath, moduleExports);
    console.log('✅ Hot updated Jasmine suites from:', filePath);
  }

  // Handle HMR messages
  async function handleMessage(message) {
    if (message.type === 'hmr:connected') {
      console.log('🔥 HMR enabled on server');
      await loadSpecs(message.srcFiles, message.specFiles);
      return;
    }

    if (message.type === 'hmr:update') {
      const update = message.data;
      if (!update) return;

      if (update.type === 'full-reload') {
        console.log('🔄 Full reload required');
        location.reload();
        return;
      }

      console.log('🔥 Hot updating:', update.path);

      try {
        let newModule = null;
        if (update.content) {
          newModule = await import('/' + update.path + \`?t=\${Date.now()}\`);
          moduleRegistry.set(update.path, newModule);
        }

        await hotUpdateSpec(update.path, newModule);
        console.log('✅ HMR update applied:', update.path);
      } catch (err) {
        console.error('❌ HMR update failed:', err);
        location.reload();
      }
    }
  }

  return {
    handleMessage,
    attachFilePathToSuites,
    detachFilePathSuites,
    clearCache: (filePath) => {
      if (filePath) moduleRegistry.delete(filePath);
      else moduleRegistry.clear();
    }
  };
})();
`;
  }

  private getRuntimeHelpersScript(): string {
    return `
(function (globalThis) {
  // Wait for Jasmine to be available
  function waitForJasmine(maxAttempts = 50, interval = 100) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      function check() {
        if (globalThis.jasmine && globalThis.jasmine.getEnv) {
          resolve(globalThis.jasmine.getEnv());
        } else if (attempts >= maxAttempts) {
          reject(new Error('Jasmine environment not found after waiting'));
        } else {
          attempts++;
          setTimeout(check, interval);
        }
      }
      
      check();
    });
  }

  async function initializeRunner() {
    let env;
    try {
      env = await waitForJasmine();
      console.log('✅ Jasmine environment found');
    } catch (error) {
      console.warn('⚠️ Jasmine environment not found:', error.message);
      return;
    }

    env.configure({ autoCleanClosures: false });

    function isSpec(child) {
      return child && typeof child.id === 'string' && !child.children;
    }

    function isSuite(child) {
      return child && Array.isArray(child.children);
    }

    function getAllSpecs() {
      const specs = [];
      const traverse = suite => {
        (suite.children || []).forEach(child => {
          if (isSpec(child)) specs.push(child);
          if (isSuite(child)) traverse(child);
        });
      };
      traverse(env.topSuite());
      return specs;
    }

    function getAllSuites() {
      const suites = [];
      const traverse = suite => {
        suites.push(suite);
        (suite.children || []).forEach(child => {
          if (isSuite(child)) traverse(child);
        });
      };
      traverse(env.topSuite());
      return suites;
    }

    // Store original filter to restore later
    let originalSpecFilter = null;
    let isExecuting = false;

    // SINGLETON REPORTER: Created once, added once, reused across runs
    const customReporter = {
      results: [],  // Per-run results storage
      currentSpecIdSet: null,  // Current filter set for this run

      // Reset state at the start of each run
      jasmineStarted: function () {
        this.results = [];
      },

      specStarted: function (result) {
        if (this.currentSpecIdSet && this.currentSpecIdSet.has(result.id)) {
          console.log(\`▶️ Running [\${result.id}]: \${result.description}\`);
        }
      },

      specDone: function (result) {
        if (this.currentSpecIdSet && this.currentSpecIdSet.has(result.id)) {
          this.results.push(result);
          const status = result.status.toUpperCase();
          console.log(\`[\${status}] \${result.description}\`);
          
          if (result.failedExpectations && result.failedExpectations.length > 0) {
            result.failedExpectations.forEach(f => 
              console.error('❌', f.message, f.stack ? '\\n' + f.stack : '')
            );
          }
        }
      },

      jasmineDone: () => {
        // Always restore filter, even on errors
        if (originalSpecFilter !== null) {
          env.configure({ specFilter: originalSpecFilter });
        }
        isExecuting = false;
      },

      // Fallback for unhandled errors (ensures cleanup)
      jasmineErrored: (error) => {
        console.error('❌ Jasmine execution errored:', error);
        if (originalSpecFilter !== null) {
          env.configure({ specFilter: originalSpecFilter });
        }
        isExecuting = false;
      }
    };

    // Add the reporter ONCE after setup
    env.addReporter(customReporter);
    console.log('📊 Custom reporter attached (reusable).');

    // Reset the environment to allow re-execution
    function resetEnvironment() {
      // Reset all specs and suites
      const resetNode = (node) => {
        if (node.result) {
          node.result = {
            status: 'pending',
            failedExpectations: [],
            passedExpectations: []
          };
        }
        if (node.children) {
          node.children.forEach(resetNode);
        }
      };
      
      resetNode(env.topSuite());
    }

    async function executeSpecsByIds(specIds) {
      // Prevent concurrent executions
      if (isExecuting) {
        console.warn('⚠️ Execution already in progress. Please wait...');
        return [];
      }

      return new Promise((resolve) => {
        isExecuting = true;
        customReporter.results = [];  // Reset results here too
        const specIdSet = new Set(specIds);
        customReporter.currentSpecIdSet = specIdSet;  // Set for this run
        
        // Store original filter if not already stored
        if (originalSpecFilter === null) {
          originalSpecFilter = env.specFilter;
        }

        // Reset environment before execution
        resetEnvironment();

        // Set filter to only run our target specs
        env.configure({
          specFilter: (spec) => specIdSet.has(spec.id)
        });

        // Create a one-time resolver for this execution
        const originalJasmineDone = customReporter.jasmineDone;
        customReporter.jasmineDone = () => {
          originalJasmineDone.call(customReporter);
          resolve(customReporter.results);
          // Restore original jasmineDone
          customReporter.jasmineDone = originalJasmineDone;
        };

        // Execute with the filter in place
        env.execute();
      });
    }

    async function runTests(filters) {
      const allSpecs = getAllSpecs();
      const filterArr = Array.isArray(filters) ? filters : [filters];
      const matching = filterArr.length
        ? allSpecs.filter(s => filterArr.some(f => 
            f instanceof RegExp ? f.test(s.description) : s.id === f || s.description === f
          ))
        : allSpecs;

      if (!matching.length) {
        console.warn('No matching specs found for:', filters);
        return [];
      }

      const specIds = matching.map(s => s.id);
      console.log(\`🎯 Executing \${matching.length} spec(s):\`, 
        matching.map(s => s.description)
      );

      return await executeSpecsByIds(specIds);
    }

    async function runTest(filter) {
      if (Array.isArray(filter)) {
        throw new Error('runTest() only accepts a single spec or RegExp, not an array.');
      }
      return runTests(filter);
    }

    async function runSuite(name) {
      const suites = getAllSuites();
      const matching = suites.filter(s => 
        name instanceof RegExp ? name.test(s.description) : s.description.includes(name)
      );
      
      if (!matching.length) {
        console.warn('No matching suites found for:', name);
        return [];
      }

      const allSpecs = matching.flatMap(suite => {
        const specs = [];
        const traverse = s => {
          (s.children || []).forEach(child => {
            if (isSpec(child)) specs.push(child);
            if (isSuite(child)) traverse(child);
          });
        };
        traverse(suite);
        return specs;
      });

      console.log(\`🎯 Executing \${allSpecs.length} spec(s) from suite:\`, 
        matching.map(s => s.description)
      );

      const specIds = allSpecs.map(s => s.id);
      return await executeSpecsByIds(specIds);
    }

    function listTests() {
      const specs = getAllSpecs();
      console.table(specs.map(s => ({
        id: s.id,
        name: s.description,
        suite: findSuiteName(s)
      })));
    }

    function findSuiteName(spec) {
      if (typeof spec.getPath !== 'function') return '(root)';
      const path = spec.getPath();
      if (!Array.isArray(path) || path.length < 2) return '(root)';

      const suiteParts = path.slice(0, -1).map(p => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        if (typeof p.description === 'string' && p.description.trim()) return p.description.trim();
        if (typeof p.getFullName === 'function') {
          // some Jasmine nodes provide getFullName()
          try { return p.getFullName(); } catch (e) { /* ignore */ }
        }
        // as a last resort stringify
        return String(p);
      }).filter(Boolean);

      return suiteParts.length ? suiteParts.join(' > ') : '(root)';
    }

    globalThis.runner = {
      runTests,
      runTest,
      runSuite,
      listTests,
      reload: () => location.reload(),
    };

    console.log('%c✅ Jasmine 5 runner loaded with reusable reporter!', 'color: green; font-weight: bold;');
    console.log('Usage: await runner.runTest("spec0") or await runner.runTest(/pattern/)');
    console.log('       await runner.runTests(["spec0", "spec1"])');
    console.log('       await runner.runSuite("Observable")');
  }

  // Start initialization
  initializeRunner().catch(error => {
    console.error('Failed to initialize Jasmine runner:', error);
  });
})(window);
`;
  }
}