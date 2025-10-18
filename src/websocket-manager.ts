import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import JSONCleaner from './json-cleaner';
import { Reporter } from './multi-reporter';
import { HmrManager, HmrUpdate } from './hmr-manager';
import { FileDiscoveryService } from './file-discovery-service';
import { ViteConfigBuilder } from './vite-config-builder';
import { ViteJasmineConfig } from './vite-jasmine-config';
import path from 'path';

export class WebSocketManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private wsClients: WebSocket[] = [];
  private hmrManager: HmrManager | null = null;
  private hmrEnabled: boolean = false;

  constructor(private fileDiscovery: FileDiscoveryService, private config: ViteJasmineConfig, private server: http.Server, private reporter: Reporter) {
    super();
    this.createWebSocketServer();
  }

  private createWebSocketServer(): void {
    this.wss = new WebSocketServer({ server: this.server });
    
    this.wss.on('connection', async (ws: WebSocket) => {
      console.log('🔌 WebSocket client connected');
      this.wsClients.push(ws);
      // Send HMR status on connection
      if (this.hmrEnabled) {
        const files = await this.fileDiscovery.scanDir(this.config.outDir, '/**/*.js');
        this.sendToClient(ws, { 
          type: 'hmr:connected',
          specFiles: files.filter(file => file.endsWith('.spec.js')).map(file => path.basename(file)).sort(),
          srcFiles: files.filter(file => !file.endsWith('.spec.js') && file.endsWith('.js')).map(file => path.basename(file)).sort(),
          enabled: true 
        });
      }
      
      
      const cleaner = new JSONCleaner();
      
      ws.on('message', (data: Buffer) => {
        try {
          const message = cleaner.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('❌ Failed to parse WebSocket message:', error);
        }
      });
      
      ws.on('close', () => {
        this.wsClients = this.wsClients.filter(client => client !== ws);
      });
      
      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        this.wsClients = this.wsClients.filter(client => client !== ws);
      });
    });
  }

  private handleWebSocketMessage(message: any): void {
    try {
      switch (message.type) {
        case 'userAgent':
          (this.reporter as any)?.userAgent?.(message);
          break;

        case 'jasmineStarted':
          this.reporter?.jasmineStarted(message);
          break;
        
        case 'suiteStarted':
          this.reporter?.suiteStarted(message);
          break;
        
        case 'specStarted':
          this.reporter?.specStarted(message);
          break;
        
        case 'specDone':
          this.reporter?.specDone(message);
          break;
        
        case 'suiteDone':
          this.reporter?.suiteDone(message);
          break;

        case 'jasmineDone':
          this.reporter?.jasmineDone(message);
          
          const coverage = message.coverage ? new JSONCleaner().parse(message.coverage) : null;
          const success = message.overallStatus === 'passed' && message.failedSpecsCount === 0;
          this.emit('testsCompleted', { success, coverage });
          break;

        case 'hmr:ready':
          console.log('🔥 Client HMR runtime ready');
          break;

        case 'hmr:error':
          console.error('❌ HMR error on client:', message.error);
          break;
          
        default:
          console.warn('⚠️  Unknown WebSocket message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  }

  // New method to enable HMR
  enableHmr(hmrManager: HmrManager): void {
    this.hmrManager = hmrManager;
    this.hmrEnabled = true;

    // Listen for HMR updates from the file watcher
    this.hmrManager.on('hmr:update', (update: HmrUpdate) => {
      this.broadcast({
        type: 'hmr:update',
        data: update,
      });
    });

    console.log('🔥 HMR enabled on WebSocket server');
  }

  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    this.wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  private sendToClient(client: WebSocket, message: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  async cleanup(): Promise<void> {
    if (this.hmrManager) {
      await this.hmrManager.stop();
      this.hmrManager = null;
    }

    if (this.wsClients.length > 0) {
      for (const client of this.wsClients) {
        try {
          if (client.readyState === WebSocket.OPEN) client.close();
        } catch (err) {
          console.error('❌ Error closing WebSocket client:', err);
        }
      }
      this.wsClients = [];
    }

    if (this.wss) {
      await new Promise<void>(resolve => this.wss!.close(() => resolve()));
      this.wss = null;
    }
  }
}