import * as fs from 'fs';
import * as path from 'path';
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import { fileURLToPath } from 'url';

export class HtmlGenerator {
  constructor(private config: ViteJasmineConfig) { }

  generateHtmlFile(): void {
    const htmlDir = this.config.outDir;
    if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });

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
    if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });

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
  <title>${this.config.htmlOptions?.title || 'Jasmine Tests Runner'}</title>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css">
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot0.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot1.js"></script>
</head>
<body>
  <div class="jasmine_html-reporter"></div>
  <script type="module">
    ${imports}
    
    ${this.getWebSocketEventForwarderScript()}
    jasmine.getEnv().addReporter(new WebSocketEventForwarder());
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
  <title>${this.config.htmlOptions?.title || 'Jasmine Tests Runner (HMR)'}</title>
  <link rel="stylesheet" href="/node_modules/jasmine-core/lib/jasmine-core/jasmine.css">
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js"></script>
  <script src="/node_modules/jasmine-core/lib/jasmine-core/boot0.js"></script>
</head>
<body>
  <div class="jasmine_html-reporter"></div>
  <script type="module">
    ${imports}

    ${this.getWebSocketEventForwarderScript()}
    ${this.getHmrClientScript()}
    ${this.getRuntimeHelpersScript()}
    const forwarder = new WebSocketEventForwarder();
    forwarder.connect();
    jasmine.getEnv().addReporter(forwarder);
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
  const self = this;

  this.connect = function() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host;

    if (!window.HMRClient) {
      setTimeout(() => self.connect(), 50);
      return;
    }

    self.ws = new WebSocket(wsUrl);

    self.ws.onopen = () => {
      self.connected = true;
      while (self.messageQueue.length > 0) self.send(self.messageQueue.shift());
    };

    self.ws.onclose = () => {
      self.connected = false;
      setTimeout(() => self.connect(), 1000);
    };

    self.ws.onerror = (err) => {
      self.connected = false;
      console.error('WebSocket error:', err);
    };

    self.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (window.HMRClient && (message.type === 'hmr:connected' || message.type === 'hmr:update')) {
          await window.HMRClient.handleMessage(message);
        }
      } catch (err) {
        console.error('Failed to handle WebSocket message:', err);
      }
    };
  };

  this.send = function(msg) {
    if (self.connected && self.ws && self.ws.readyState === WebSocket.OPEN) {
      self.ws.send(JSON.stringify(msg));
    } else {
      self.messageQueue.push(msg);
    }
  };

  this.jasmineStarted = function(suiteInfo) {
    self.send({ type: 'start', totalSpecs: suiteInfo.totalSpecsDefined, timestamp: Date.now() });
  };

  this.specDone = function(result) {
    self.send({ type: 'specDone', id: result.id, description: result.description, status: result.status, timestamp: Date.now() });
  };

  this.jasmineDone = function(result) {
    self.send({ type: 'done', totalTime: result.totalTime || 0, timestamp: Date.now() });
    window.jasmineFinished = true;
    if (!window.HMRClient) setTimeout(() => self.ws?.close(), 1000);
  };
}`;
  }

  private getHmrClientScript(): string {
    return `window.HMRClient = (function() {
  const moduleRegistry = new Map();
  async function handleMessage(message) {
    if (message.type === 'hmr:connected') return;
    if (message.type === 'hmr:update') {
      const update = message.data;
      if (!update) return;
      if (update.type === 'full-reload') return location.reload();

      try {
        if (window.runner && typeof window.runner.clearResults === 'function') {
          window.runner.clearResults(update.path);
        }

        const blob = new Blob([update.content], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const newModule = await import(url);
        moduleRegistry.set(update.path, newModule);

        if (window.runner && typeof window.runner.attachFilePathToSuites === 'function') {
          window.runner.attachFilePathToSuites(update.path, newModule);
        }

        URL.revokeObjectURL(url);
        console.log('✅ HMR update applied for:', update.path);
      } catch (err) {
        console.error('❌ HMR update failed:', err);
        location.reload();
      }
    }
  }
  return { handleMessage };
})();`;
  }

  private getRuntimeHelpersScript(): string {
    return `(function(globalThis) {
  function waitForJasmine(maxAttempts=50, interval=100) {
    return new Promise((resolve, reject) => {
      let attempts=0;
      function check() {
        if (globalThis.jasmine && globalThis.jasmine.getEnv) resolve(globalThis.jasmine.getEnv());
        else if (attempts>=maxAttempts) reject(new Error('Jasmine env not found'));
        else { attempts++; setTimeout(check, interval); }
      }
      check();
    });
  }

  async function initializeRunner() {
    let env;
    try { env = await waitForJasmine(); } catch(e){console.warn('⚠️ Jasmine not found:', e.message); return;}
    env.configure({ autoCleanClosures: false });

    function isSpec(child){return child && typeof child.id==='string' && !child.children;}
    function isSuite(child){return child && Array.isArray(child.children);}
    function getAllSpecs(){const specs=[]; (function traverse(suite){(suite.children||[]).forEach(c=>{if(isSpec(c)) specs.push(c); if(isSuite(c)) traverse(c);});})(env.topSuite()); return specs;}
    function getAllSuites(){const suites=[]; (function traverse(suite){suites.push(suite); (suite.children||[]).forEach(c=>{if(isSuite(c)) traverse(c);});})(env.topSuite()); return suites;}

    let originalSpecFilter=null, isExecuting=false;
    const customReporter = {
      results: [], currentSpecIdSet: null,
      jasmineStarted(){this.results=[];},
      specStarted(r){if(this.currentSpecIdSet?.has(r.id)) console.log('▶️', r.description);},
      specDone(r){if(this.currentSpecIdSet?.has(r.id)){this.results.push(r); console.log('[',r.status.toUpperCase(),']',r.description); r.failedExpectations?.forEach(f=>console.error('❌',f.message,f.stack||''));}},
      jasmineDone(){if(originalSpecFilter!==null) env.configure({specFilter: originalSpecFilter}); isExecuting=false;},
    };
    env.addReporter(customReporter);

    function resetEnvironment(){(function resetNode(node){if(node.result) node.result={status:'pending',failedExpectations:[],passedExpectations:[]}; node.children?.forEach(resetNode);})(env.topSuite());}
    async function executeSpecsByIds(specIds){if(isExecuting){console.warn('⚠️  Execution in progress'); return [];} return new Promise(resolve=>{isExecuting=true; customReporter.results=[]; const specIdSet=new Set(specIds); customReporter.currentSpecIdSet=specIdSet; if(originalSpecFilter===null) originalSpecFilter=env.specFilter; env.configure({specFilter: s=>specIdSet.has(s.id)}); const originalJasmineDone=customReporter.jasmineDone; customReporter.jasmineDone=function(){originalJasmineDone.call(customReporter); resolve(customReporter.results); customReporter.jasmineDone=originalJasmineDone;}; env.execute();});}

    async function runTests(filters){const allSpecs=getAllSpecs(); const fArr=Array.isArray(filters)?filters:[filters]; const matching=fArr.length?allSpecs.filter(s=>fArr.some(f=>f instanceof RegExp?f.test(s.description):s.id===f||s.description===f)):allSpecs; if(!matching.length){console.warn('No matching specs:',filters); return [];} return executeSpecsByIds(matching.map(s=>s.id));}
    async function runTest(filter){if(Array.isArray(filter)) throw new Error('runTest only accepts single filter'); return runTests(filter);}
    async function runSuite(name){const suites=getAllSuites(); const matching=suites.filter(s=>name instanceof RegExp?name.test(s.description):s.description.includes(name)); if(!matching.length){console.warn('No matching suites:',name); return [];} const allSpecs=matching.flatMap(s=>{const specs=[]; (function traverse(s){(s.children||[]).forEach(c=>{if(isSpec(c)) specs.push(c); if(isSuite(c)) traverse(c);});})(s); return specs;}); return executeSpecsByIds(allSpecs.map(s=>s.id));}
    function listTests(){console.table(getAllSpecs().map(s=>({id:s.id,name:s.description,suite: findSuiteName(s)})));}
    
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

    function clearResults(){document.querySelector('.jasmine_html-reporter')?.remove(); console.clear(); customReporter.results=[]; customReporter.currentSpecIdSet=null;}

    function attachFilePathToSuites(filePath, moduleExports){getAllSuites().forEach(suite=>{if(!suite._filePath && moduleExports?.__specFile===filePath) suite._filePath=filePath; (suite.children||[]).forEach(child=>{if(isSpec(child) && !child._filePath) child._filePath=filePath;});});}

    globalThis.runner={runTests,runTest,runSuite,listTests,clearResults,getAllSpecs,getAllSuites,resetEnvironment,attachFilePathToSuites};
    console.log('%c✅ Jasmine 5 runner loaded with reusable reporter!', 'color: black; font-weight: bold;');
    console.log('Usage: await runner.runTest("spec0") or await runner.runTest(/pattern/)');
    console.log('       await runner.runTests(["spec0", "spec1"])');
    console.log('       await runner.runSuite("Observable")');
  }

  initializeRunner().catch(err=>console.error('Failed initializing Jasmine runner:',err));
})(window);`;
  }
}
