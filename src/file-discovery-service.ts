import { glob } from "glob";
import { ViteJasmineConfig } from "./vite-jasmine-config";
import { norm } from "./utils";
import * as fs from "fs/promises";
import * as path from "path";

export class FileDiscoveryService {
  constructor(private config: ViteJasmineConfig) {}

  async scanDir(dir: string, pattern: string, exclude: string[] = []): Promise<string[]> {
    const cleanPattern = pattern.startsWith('/') || pattern.startsWith('**') 
      ? pattern 
      : `/${pattern}`;
    const basePath = norm(path.join(dir, cleanPattern)).replace(/^\//, '');
    
    try {
      let files = await glob(basePath, { absolute: true, ignore: exclude });
      return files.map((s) => norm(s));
    } catch (error) {
      console.error("❌ Error discovering files:", error);
      throw new Error("Failed to discover source and test files");
    }
  }

  async filterExistingFiles(paths: string[]): Promise<string[]> {
    const existingFiles: string[] = [];
    
    await Promise.all(
      paths.map(async (filePath) => {
        const normalizedPath = norm(filePath);
        try {
          await fs.access(normalizedPath);
          existingFiles.push(normalizedPath);
        } catch {
          // File doesn't exist, skip it
        }
      })
    );
    
    return existingFiles;
  }

  async discoverSources(): Promise<{ srcFiles: string[]; specFiles: string[] }> {
    // Normalize path for cross-platform compatibility
    try {
      const srcFiles = await this.scanDir(norm(this.config.srcDir), '/**/*.{ts,js,mjs}', ["**/node_modules/**", "**/*.spec.*"]);
      const specFiles = await this.scanDir(norm(this.config.testDir), '/**/*.spec.{ts,js,mjs}', ["**/node_modules/**"]);
      return { srcFiles, specFiles };
    } catch (error) {
      console.error("❌ Error discovering files:", error);
      throw new Error("Failed to discover source and test files");
    }
  }

  getOutputName(filePath: string): string {
    const relative = filePath.startsWith(norm(this.config.testDir))
      ? path.relative(this.config.testDir, filePath)
      : path.relative(norm(this.config.srcDir), filePath);

    const ext = path.extname(filePath);
    return norm(relative).replace(ext, '.js').replace(/[\/\\]/g, '_');
  }
}
