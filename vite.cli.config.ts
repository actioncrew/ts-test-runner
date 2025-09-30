import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTERNALS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
  'v8', 'vm', 'zlib', 'worker_threads', 'ws', 'fsevents', 'chromium-bidi', 'glob',
  'vite', 'rollup', 'module-alias', 'playwright', 'playwright-core', 'esbuild', 
  'fdir', 'picomatch', 'jasmine-core', 'tinyglobby', 'path-scurry', 'lru-cache',
  'istanbul-lib-instrument', 'istanbul-lib-report', 'istanbul-lib-source-maps',
  'istanbul-reports', 'istanbul-api', 'istanbul-lib-coverage'
];

export default defineConfig({
  plugins: [
    copy({
      targets: [
        { src: 'postinstall.mjs', dest: 'dist/ts-test-runner/' },
        { src: 'assets/favicon.ico', dest: 'dist/ts-test-runner/assets/' },
        { src: 'node_modules/istanbul-lib-instrument/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/istanbul-lib-coverage/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/istanbul-lib-report/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/istanbul-lib-source-maps/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/istanbul-reports/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/istanbul-api/**/*', dest: 'dist/ts-test-runner/node_modules/' },
        { src: 'node_modules/glob/**/*', dest: 'dist/ts-test-runner/node_modules' },
        { src: 'node_modules/ws/**/*', dest: 'dist/ts-test-runner/node_modules' },
        { src: 'node_modules/jasmine-core/**/*', dest: 'dist/ts-test-runner/node_modules' },
        { src: 'node_modules/fdir/**/*', dest: 'dist/ts-test-runner/node_modules' },
        { src: 'node_modules/picomatch/**/*', dest: 'dist/ts-test-runner/node_modules' },
        { src: 'node_modules/vite/**/*', dest: 'dist/ts-test-runner/node_modules' },
      ],
      hook: 'writeBundle',
      flatten: false
    })
  ],
  build: {
    target: 'node22',
    outDir: 'dist/ts-test-runner/',
    emptyOutDir: false,
    lib: {
      entry: path.resolve('index.ts'),
      formats: ['es'],
      fileName: () => 'lib/index.js'
    },
    minify: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      input: path.resolve(__dirname, './src/index.ts'),
      output: {
        entryFileNames: 'bin/ts-test-runner',
        format: 'es',
        banner: `#!/usr/bin/env node
// @vite-ignore
const url = new URL("../../../src/node/constants.ts", import.meta.url);

import { createRequire as ___createRequire } from 'module';
const require = ___createRequire(import.meta.url);

const ___fileURLToPath = require('url').fileURLToPath;
const ___path = require('path');

const __filename = ___fileURLToPath(import.meta.url);
const __dirname = ___path.dirname(__filename);
`,
        inlineDynamicImports: true,
        manualChunks: undefined
      },
      external: (id) => {
        if (id.startsWith('node:')) return true;
        if (EXTERNALS.includes(id)) return true;
        return false;
      }
    }
  }
});
