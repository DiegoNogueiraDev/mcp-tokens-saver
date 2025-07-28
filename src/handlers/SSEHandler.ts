import { StreamingResponseHandler } from './StreamingResponseHandler.js';
import { Logger } from '../utils/Logger.js';
import { EventEmitter } from 'events';

export interface SSEClient {
  id: string;
  response: any;
  handler: StreamingResponseHandler;
}

export interface SSEMetrics {
  activeConnections: number;
  totalMessages: number;
  errors: number;
  startTime: number;
  uptime?: number;
}

export class SSEHandler extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map();
  private logger: Logger;
  private metrics: SSEMetrics;

  constructor() {
    super();
    this.logger = new Logger('SSEHandler');
    this.metrics = {
      activeConnections: 0,
      totalMessages: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  /**
   * Handle new SSE connection
   */
  handleConnection(requestId: string, response: any): StreamingResponseHandler {
    const handler = new StreamingResponseHandler(requestId);
    
    // Set up SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no' // Disable proxy buffering
    });

    const client: SSEClient = {
      id: requestId,
      response,
      handler
    };

    this.clients.set(requestId, client);
    this.metrics.activeConnections++;

    // Send initial connection event
    this.sendEvent(response, 'connected', {
      requestId,
      timestamp: new Date().toISOString()
    });

    // Set up streaming event handlers
    handler.on('token', (token) => {
      this.sendEvent(response, 'token', token);
      this.metrics.totalMessages++;
    });

    handler.on('progress', (progress) => {
      this.sendEvent(response, 'progress', progress);
    });

    handler.on('streamComplete', (data) => {
      this.sendEvent(response, 'complete', data);
      this.closeConnection(requestId);
    });

    handler.on('error', (error) => {
      this.sendEvent(response, 'error', error);
      this.metrics.errors++;
      this.closeConnection(requestId);
    });

    // Handle client disconnect
    response.on('close', () => {
      this.closeConnection(requestId);
    });

    response.on('error', (error: Error) => {
      this.logger.error('SSE connection error', { requestId, error: error.message });
      this.closeConnection(requestId);
    });

    this.logger.info('SSE connection established', { requestId });
    this.emit('connection', { requestId, activeConnections: this.metrics.activeConnections });

    return handler;
  }

  /**
   * Send SSE event
   */
  private sendEvent(response: any, event: string, data: any): void {
    try {
      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      response.write(eventData);
    } catch (error) {
      this.logger.error('Failed to send SSE event', { event, error });
    }
  }

  /**
   * Close SSE connection
   */
  closeConnection(requestId: string): void {
    const client = this.clients.get(requestId);
    if (client) {
      try {
        client.response.end();
        client.handler.cleanup();
      } catch (error) {
        this.logger.error('Error closing SSE connection', { requestId, error });
      }
      
      this.clients.delete(requestId);
      this.metrics.activeConnections--;
      
      this.logger.info('SSE connection closed', { 
        requestId, 
        activeConnections: this.metrics.activeConnections 
      });
      this.emit('disconnection', { requestId, activeConnections: this.metrics.activeConnections });
    }
  }

  /**
   * Get current SSE metrics
   */
  getMetrics(): SSEMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime
    };
  }

  /**
   * Get active connections
   */
  getActiveConnections(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Broadcast message to all active connections
   */
  broadcast(event: string, data: any): void {
    for (const [requestId, client] of this.clients) {
      try {
        this.sendEvent(client.response, event, data);
      } catch (error) {
        this.logger.error('Failed to broadcast to client', { requestId, error });
        this.closeConnection(requestId);
      }
    }
  }

  /**
   * Health check endpoint
   */
  healthCheck(): any {
    return {
      status: 'healthy',
      activeConnections: this.metrics.activeConnections,
      totalMessages: this.metrics.totalMessages,
      errors: this.metrics.errors,
      uptime: Date.now() - this.metrics.startTime
    };
  }

  /**
   * Clean up all connections
   */
  shutdown(): void {
    this.logger.info('Shutting down SSE handler');
    
    for (const requestId of this.clients.keys()) {
      this.closeConnection(requestId);
    }
    
    this.clients.clear();
    this.metrics.activeConnections = 0;
  }

  /**
   * Create middleware for Express-like servers
   */
  createMiddleware() {
    return (req: any, res: any, next: any) => {
      if (req.headers.accept === 'text/event-stream') {
        const requestId = req.query.requestId || req.headers['x-request-id'] || `req_${Date.now()}`;
        const handler = this.handleConnection(requestId, res);
        
        // Attach handler to request for later use
        req.streamingHandler = handler;
        return;
      }
      next();
    };
  }

  /**
   * Create a simple HTTP handler for basic Node.js servers
   */
  createHttpHandler() {
    return (req: any, res: any) => {
      if (req.url.startsWith('/stream') && req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const requestId = url.searchParams.get('requestId') || `req_${Date.now()}`;
        
        const handler = this.handleConnection(requestId, res);
        
        // Return handler for external use
        return handler;
      }
      
      res.writeHead(404);
      res.end('Not found');
    };
  }
}