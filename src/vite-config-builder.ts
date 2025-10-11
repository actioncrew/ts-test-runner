import * as fs from 'fs';
import * as path from 'path';
import { InlineConfig } from "vite";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import JSONCleaner from './json-cleaner';

export class ViteConfigBuilder {
  inputMap: Record<string, string> = {};

  constructor(private config: ViteJasmineConfig) {}

  private buildInputMap(srcFiles: string[], testFiles: string[]): Record<string, string> {
    let inputMap: Record<string, string> = {};
    // Add source files
    srcFiles.forEach(file => {
      const relPath = path.relative(this.config.srcDir, file).replace(/\.(ts|js|mjs)$/, '');
      const key = relPath.replace(/[\/\\]/g, '_');
      inputMap[key] = norm(file);
    });

    // Add test files
    testFiles.forEach(file => {
      const relPath = path.relative(this.config.testDir, file).replace(/\.spec\.(ts|js|mjs)$/, '');
      const key = `${relPath.replace(/[\/\\]/g, '_')}.spec`;
      inputMap[key] = norm(file);
    });

    return inputMap;
  }

  /** Full library build, preserves modules for proper relative imports */
  createViteConfig(srcFiles: string[], testFiles: string[]): InlineConfig {
    // For incremental rebuild:
    this.inputMap = this.buildInputMap(srcFiles, testFiles);

    return {
      ...this.config.viteConfig,
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: {
          input: this.inputMap,
          output: {
            format: 'es',
            entryFileNames: '[name].js', // flattened
            chunkFileNames: '[name]-[hash].js',
            preserveModules: true,      // important: flatten everything
          },
          preserveEntrySignatures: 'strict',
        },
        sourcemap: this.config.viteBuildOptions?.sourcemap ?? true,
        target: this.config.viteBuildOptions?.target ?? 'es2022',
        minify: this.config.viteBuildOptions?.minify ?? false,
        emptyOutDir: true
      },
      resolve: { alias: this.createPathAliases() },
      esbuild: { target: 'es2022', keepNames: false },
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'warn',
    };
  }

  /** Incremental or partial rebuild, flattens output file names */
  createViteConfigForFiles(srcFiles: string[], testFiles: string[], viteCache: any): InlineConfig {
    const input = this.buildInputMap(srcFiles, testFiles); // keys already flattened
    this.inputMap = { ...this.inputMap, ...input };
    
    return {
      ...this.config.viteConfig,
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: {
          input: this.inputMap,
          preserveEntrySignatures: 'allow-extension',
          output: {
            format: 'es',
            entryFileNames: ({ name }) => `${name.replace(/[\/\\]/g, '_')}.js`,
            chunkFileNames: '[name].js',
            preserveModules: true,
            preserveModulesRoot: this.config.srcDir
          },
          cache: viteCache,
        },
        sourcemap: true,
        target: 'es2022',
        minify: false,
        emptyOutDir: false,
      },
      resolve: { alias: this.createPathAliases() },
      esbuild: { target: 'es2022', keepNames: false, treeShaking: false },
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'warn',
    };
  }

  createPathAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    const cleaner = new JSONCleaner();
    try {
      const tsconfigPath = this.config.tsconfig || 'tsconfig.json';
      if (fs.existsSync(tsconfigPath)) {
        const tsconfig = cleaner.parse(fs.readFileSync(tsconfigPath, 'utf8'));
        const baseUrl = tsconfig.compilerOptions?.baseUrl || '.';
        const paths = tsconfig.compilerOptions?.paths || {};
        for (const [alias, pathArray] of Object.entries(paths)) {
          if (Array.isArray(pathArray) && pathArray.length > 0) {
            const cleanAlias = alias.replace(/\/\*$/, '');
            const cleanPath = (pathArray[0] as string).replace(/\/\*$/, '');
            aliases[cleanAlias] = norm(path.resolve(baseUrl, cleanPath));
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ tsconfig parsing failed:', err);
    }
    return aliases;
  }
}
