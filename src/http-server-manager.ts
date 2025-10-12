import * as fs from 'fs';
import * as path from 'path';
import http, { createServer } from 'http';
import { ViteJasmineConfig } from './vite-jasmine-config';
import { fileURLToPath, parse } from 'url';
import { extname } from 'path';
import { norm } from './utils';

export class HttpServerManager {
  private server: http.Server | null = null;

  constructor(private config: ViteJasmineConfig) {}

  async startServer(): Promise<http.Server> {
    const port = this.config.port!;
    const outDir = this.config.outDir;

    const __filename = norm(fileURLToPath(import.meta.url));
    const __dirname = norm(path.dirname(__filename));
    const vendorDir = norm(path.join(__dirname, '../node_modules'));
    
    this.server = createServer((req, res) => {
      let { pathname } = parse(req.url === '/' ? '/index.html' : req.url!, true);
      const filePath = decodeURIComponent(pathname!);

      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      
      // Handle CORS preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }

      let resolvedPath: string;

      if (filePath.startsWith('/node_modules/')) {
        const relativePath = filePath.replace(/^\/node_modules\//, '');
        resolvedPath = norm(path.join(vendorDir, relativePath));
      } else {
        resolvedPath = norm(path.join(outDir, filePath));
      }

      resolvedPath = norm(path.normalize(resolvedPath));

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        const ext = extname(resolvedPath);
        res.writeHead(200, {
          'Content-Type': this.getContentType(ext),
          'Access-Control-Allow-Origin': '*'
        });
        res.end(fs.readFileSync(resolvedPath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, () => {
        console.log(`🚀 Test server running at http://localhost:${port}`);
        resolve(this.server!);
      });

      this.server!.on('error', (error) => {
        console.error('❌ Server error:', error);
        reject(error);
      });
    });
  }

  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    return types[ext] || 'application/octet-stream';
  }

  async waitForServerReady(url: string, timeout = 5000): Promise<void> {
    const start = Date.now();
    const { hostname, port } = new URL(url);

    console.log(`⏳ Waiting for server to be ready at ${url}...`);

    while (Date.now() - start < timeout) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.request({
            hostname,
            port,
            path: '/',
            method: 'HEAD',
            timeout: 1000
          }, (res) => {
            res.resume();
            resolve();
          });

          req.on("error", reject);
          req.on("timeout", () => {
            req.destroy();
            reject(new Error('Timeout'));
          });

          req.end();
        });
        return;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    throw new Error(`Server not ready at ${url} after ${timeout}ms`);
  }

  async cleanup(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close(err => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }
}