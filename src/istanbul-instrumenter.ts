import { ViteJasmineConfig } from "./vite-jasmine-config";
import * as fs from "fs";
import path from "path";
import { createInstrumenter } from "istanbul-lib-instrument";

export interface InstrumenterOptions {
  filename: string;
  source: string;
  sourceMap: any;
}

export class IstanbulInstrumenter {
  private config: ViteJasmineConfig;
  private instrumenter: ReturnType<typeof createInstrumenter>;

  constructor(config: ViteJasmineConfig) {
    this.config = config;

    // Create Istanbul instrumenter if coverage is enabled
    this.instrumenter = createInstrumenter({
      coverageVariable: "__coverage__",
      produceSourceMap: true, // generate instrumented map
    });
  }

  async instrument({ filename, source, sourceMap }: InstrumenterOptions): Promise<string> {
    // Only instrument if coverage is enabled
    if (!this.config.coverage) return source;

    // Skip test files (*.spec.js or *.spec.map.js)
    if (/\.spec(\.map)?\.js$/i.test(filename)) return source;

    // Ensure only JS files are instrumented
    if (!filename.endsWith(".js")) return source;

    // Instrument with Istanbul, preserving original source map if provided
    const instrumentedCode = this.instrumenter.instrumentSync(source, filename, sourceMap);
    return instrumentedCode;
  }

  /**
   * Convenience method: read file and instrument it, automatically using existing source map if available
   */
  async instrumentFile(filePath: string): Promise<string> {
    const source = fs.readFileSync(filePath, "utf-8");

    // Check for existing source map
    const mapFile = filePath + ".map";
    let sourceMap;
    if (fs.existsSync(mapFile)) {
      sourceMap = JSON.parse(fs.readFileSync(mapFile, "utf-8"));
    }

    return this.instrument({ filename: filePath, source, sourceMap });
  }
}
