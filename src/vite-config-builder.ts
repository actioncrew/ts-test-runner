import * as fs from 'fs';
import * as path from 'path';
import { InlineConfig } from "vite";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from './utils';
import JSONCleaner from './json-cleaner';

export class ViteConfigBuilder {
  constructor(private config: ViteJasmineConfig) {}

  createViteConfig(): InlineConfig {
    const defaultConfig: InlineConfig = {
      root: process.cwd(),
      configFile: false,
      build: {
        outDir: this.config.outDir,
        lib: false,
        rollupOptions: { 
          input: {}, 
          output: { 
            format: 'es', 
            entryFileNames: '[name].js', 
            chunkFileNames: 'chunks/[name]-[hash].js', 
            preserveModules: true, 
            preserveModulesRoot: this.config.srcDir 
          }, 
          preserveEntrySignatures: 'strict' 
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
      ...this.config.viteConfig
    };
    return defaultConfig;
  }

  private createPathAliases(): Record<string, string> {
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
