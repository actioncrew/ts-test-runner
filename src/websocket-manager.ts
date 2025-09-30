import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import JSONCleaner from './json-cleaner';
import { Reporter } from './multi-reporter';

export class WebSocketManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private wsClients: WebSocket[] = [];

  constructor(private server: http.Server, private reporter: Reporter) {
    super();
    this.createWebSocketServer();
  }

  private createWebSocketServer(): void {
    this.wss = new WebSocketServer({ server: this.server });
    
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔌 WebSocket client connected');
      this.wsClients.push(ws);
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
        case 'start':
          this.reporter?.jasmineStarted({ 
            totalSpecsDefined: message.totalSpecs || 0 
          });
          break;
          
        case 'specDone':
          this.reporter?.specDone({
            id: message.id,
            description: message.description,
            fullName: message.fullName,
            status: message.status,
            passedExpectations: message.passedExpectations || [],
            failedExpectations: message.failedExpectations || [],
            pendingReason: message.pendingReason || null,
            duration: message.duration || 0
          });
          break;
          
        case 'done':
          this.reporter?.jasmineDone({
            totalTime: message.totalTime || 0,
            overallStatus: message.overallStatus || 'complete',
            incompleteReason: message.incompleteReason || null,
            order: message.order || null
          });
          
          const coverage = message.coverage ? new JSONCleaner().parse(message.coverage) : null;
          const success = message.overallStatus === 'passed' && message.failedSpecsCount === 0;
          this.emit('testsCompleted', { success, coverage });
          break;
          
        default:
          console.warn('⚠️  Unknown WebSocket message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  }

  async cleanup(): Promise<void> {
    if (this.wss) {
      await new Promise<void>(resolve => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    this.wsClients = [];
  }
}