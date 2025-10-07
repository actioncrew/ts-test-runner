import { glob } from "glob";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from "./utils";

export class FileDiscoveryService {
  constructor(private config: ViteJasmineConfig) {}

  async discoverFiles(): Promise<{ srcFiles: string[]; testFiles: string[] }> {
    // Normalize path for cross-platform compatibility
    const srcBase = norm(this.config.srcDir);
    const testBase = norm(this.config.testDir);

    // Match .ts, .js, .mjs
    const srcPattern = `${srcBase}/**/*.{ts,js,mjs}`;
    // Match test files with .spec.ts/.spec.js/.spec.mjs
    const testPattern = `${testBase}/**/*.spec.{ts,js,mjs}`;

    try {
      const [srcFiles, testFiles] = await Promise.all([
        glob(srcPattern, {
          absolute: true,
          ignore: ["**/node_modules/**", "**/*.spec.*"],
        }),
        glob(testPattern, {
          absolute: true,
          ignore: ["**/node_modules/**"],
        }),
      ]);

      return { srcFiles, testFiles };
    } catch (error) {
      console.error("❌ Error discovering files:", error);
      throw new Error("Failed to discover source and test files");
    }
  }
}
