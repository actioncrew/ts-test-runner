import * as fs from 'fs';
import * as path from 'path';
import { InlineConfig } from "vite";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import JSONCleaner from './json-cleaner';

export class ViteConfigBuilder {
  constructor(private config: ViteJasmineConfig) {}

  private buildInputMap(srcFiles: string[], testFiles: string[]): Record<string, string> {
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

    return input;
  }

  /** Full library build, preserves modules for proper relative imports */
  createViteConfig(srcFiles: string[], testFiles: string[]): InlineConfig {
    const input = this.buildInputMap(srcFiles, testFiles);
    return {
      ...this.config.viteConfig,
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: {
          input,
          output: {
            format: 'es',
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            preserveModules: true,
            preserveModulesRoot: this.config.srcDir,
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
  createViteConfigForFiles(changedFiles: string[], viteCache: any): InlineConfig {
    let srcFiles: string[] = [], testFiles: string[] = [];
  
    changedFiles.forEach((file) => {
      if (file.startsWith(this.config.srcDir)) {
        srcFiles.push(file);
      } else if (file.startsWith(this.config.testDir)) {
        testFiles.push(file);
      }
    })

    const input = this.buildInputMap(srcFiles, testFiles);

    return {
      ...this.config.viteConfig,
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: {
          input,
          output: {
            format: 'es',
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            preserveModules: true,
            preserveModulesRoot: this.config.srcDir,
          },
          preserveEntrySignatures: 'strict',
          cache: viteCache
        },
        sourcemap: this.config.viteBuildOptions?.sourcemap ?? true,
        target: this.config.viteBuildOptions?.target ?? 'es2022',
        minify: this.config.viteBuildOptions?.minify ?? false,
        emptyOutDir: false,
      },
      resolve: { alias: this.createPathAliases() },
      esbuild: { target: 'es2022', keepNames: false },
      define: { 'process.env.NODE_ENV': '"test"' },
      logLevel: 'warn'
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
