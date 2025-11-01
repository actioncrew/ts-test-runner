import path from 'path';
import copy from 'rollup-plugin-copy';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTERNALS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs','fs/promises', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'zlib', 'worker_threads', 'ws', 'fsevents', 'chromium-bidi', 'glob',
  'vite', 'rollup', 'module-alias', 'playwright', 'playwright-core', 'esbuild', 
  'fdir', 'picomatch', 'jasmine-core', 'tinyglobby', 'path-scurry', 'lru-cache',
  'istanbul-lib-instrument', 'istanbul-lib-report', 'istanbul-lib-source-maps',
  'istanbul-reports', 'istanbul-api', 'istanbul-lib-coverage', 'chokidar', 'jasmine'
];

export default defineConfig({
  build: {
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, './src/lib.ts'),
      name: 'TsTestRunner',
      formats: ['es'],
      fileName: () => `ts-test-runner/lib/index.js`
    },
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: (id) => {
        // Externalize Node.js built-ins
        if (id.startsWith('node:')) return true;
        
        // Externalize specific modules
        if (EXTERNALS.includes(id)) return true;
        
        // Externalize all node_modules dependencies
        if (id.includes('node_modules')) return true;
        
        return false;
      },
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  },
  // Ensure TypeScript declarations are generated
  esbuild: {
    // Keep class names for better debugging
    keepNames: true,
  }
});