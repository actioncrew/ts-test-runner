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
    
    // ✅ FIX: Only include existing files in input map
    const existingSrcFiles = srcFiles.filter(fs.existsSync);
    const existingTestFiles = testFiles.filter(fs.existsSync);
    
    // Add source files
    existingSrcFiles.forEach(file => {
      const relPath = path.relative(this.config.srcDir, file).replace(/\.(ts|js|mjs)$/, '');
      const key = relPath.replace(/[\/\\]/g, '_');
      inputMap[key] = norm(file);
    });

    // Add test files
    existingTestFiles.forEach(file => {
      const relPath = path.relative(this.config.testDir, file).replace(/\.spec\.(ts|js|mjs)$/, '');
      const key = `${relPath.replace(/[\/\\]/g, '_')}.spec`;
      inputMap[key] = norm(file);
    });

    console.log(`🎯 Built input map: ${Object.keys(inputMap).length} entries (${existingSrcFiles.length} source, ${existingTestFiles.length} test)`);
    
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
    // ✅ FIX: Completely rebuild the input map to exclude deleted files
    const newInput = this.buildInputMap(srcFiles, testFiles);
    
    // ✅ FIX: Update inputMap by removing deleted files and adding new ones
    // Remove any entries where the file no longer exists
    console.log(`🗑️  Removing deleted files from input map`);
    Object.keys(this.inputMap).forEach(key => {
      if (!fs.existsSync(this.inputMap[key])) {
        delete this.inputMap[key];
      }
    });
    
    // Add/update with new input
    this.inputMap = { ...this.inputMap, ...newInput };
    
    console.log(`📦 Final input map for Vite: ${Object.keys(this.inputMap).length} files`);

    // ✅ FIX: Double-check that no deleted files are in the final input
    const finalInputMap: Record<string, string> = {};
    Object.entries(this.inputMap).forEach(([key, filePath]) => {
      if (fs.existsSync(filePath)) {
        finalInputMap[key] = filePath;
      } 
    });

    if (Object.keys(finalInputMap).length === 0) {
      console.warn('⚠️  No valid files to build after filtering deleted files');
      // Return a minimal config that won't fail
      return {
        root: process.cwd(),
        configFile: false,
        build: {
          outDir: this.config.outDir,
          rollupOptions: { input: {} },
          emptyOutDir: false
        },
        logLevel: 'warn'
      };
    }

    return {
      ...this.config.viteConfig,
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: {
          input: finalInputMap, // ✅ Use the filtered input map
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

  /** 
   * Remove a file from the input map (called by HmrManager when file is deleted)
   */
  removeFromInputMap(filePath: string): void {
    const normalizedPath = norm(filePath);
    
    // Find and remove the entry
    const entries = Object.entries(this.inputMap);
    let removed = false;
    
    for (const [key, path] of entries) {
      if (norm(path) === normalizedPath) {
        delete this.inputMap[key];
        removed = true;
        break;
      }
    }
  }

  /** 
   * Remove multiple files from the input map (for directory removal)
   */
  removeMultipleFromInputMap(filePaths: string[]): void {
    filePaths.forEach(filePath => this.removeFromInputMap(filePath));
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
      console.warn('⚠️  tsconfig parsing failed:', err);
    }
    return aliases;
  }
}