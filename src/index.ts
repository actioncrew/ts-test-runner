import { fileURLToPath } from 'url';
import { CLIHandler } from './cli-handler';

export { BrowserManager } from './browser-manager';
export { CLIHandler } from './cli-handler';
export { ConfigManager } from './config-manager';
export { ConsoleReporter } from './console-reporter';
export { CoverageReporter } from './coverage-reporter';
export { MultiReporter } from './multi-reporter';
export { FileDiscoveryService } from './file-discovery-service';
export { HtmlGenerator } from './html-generator';
export { HttpServerManager } from './http-server-manager';
export { NodeTestRunnerGenerator } from './node-test-runner-generator';
export { NodeTestRunner } from './node-test-runner';
export { WebSocketManager } from './websocket-manager';
export { IstanbulInstrumenter } from './istanbul-instrumenter'
export { HmrManager } from './hmr-manager';
export { norm } from './utils';
export { ViteConfigBuilder } from './vite-config-builder';
export type { ViteJasmineConfig } from './vite-jasmine-config';
export { ViteJasmineRunner } from './vite-jasmine-runner';
export { TeletypeConsole } from './teletype-console';

// === CLI Entry Point ===
// @vite-ignore
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  CLIHandler.run();
}