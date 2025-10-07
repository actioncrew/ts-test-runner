import type { InlineConfig } from "vite";

export interface ViteJasmineConfig {
  srcDir: string;
  testDir: string;
  outDir: string;
  tsconfig?: string;
  port?: number;
  browser?: string;
  coverage?: boolean;
  headless?: boolean;
  watch?: boolean; 
  viteConfig?: InlineConfig;
  viteBuildOptions?: {
    target?: string;
    sourcemap?: boolean;
    minify?: boolean;
    preserveModules?: boolean;
    preserveModulesRoot?: string;
  };
  jasmineConfig?: {
    srcFiles?: string[];
    specFiles?: string[];
    helpers?: string[];
    env?: { stopSpecOnExpectationFailure?: boolean; random?: boolean; timeout?: number; };
    browser?: { name: string; headless?: boolean };
    port?: number;
    reporter?: 'html' | 'console';
    reporters?: Array<{ name: string }>;
    htmlTemplate?: string;
  };
  htmlOptions?: {
    title?: string;
    includeSourceScripts?: boolean;
    includeSpecScripts?: boolean;
  };
}