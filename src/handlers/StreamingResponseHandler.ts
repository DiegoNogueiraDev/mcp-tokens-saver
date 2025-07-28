import { Logger } from '../utils/Logger';
import { EventEmitter } from 'events';

export interface StreamingToken {
  content: string;
  isComplete: boolean;
  index: number;
  metadata?: {
    model?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    finish_reason?: string;
  };
}

export interface StreamingMetrics {
  startTime: number;
  tokensReceived: number;
  tokensPerSecond: number;
  totalLatency: number;
  errorCount: number;
}

export class StreamingResponseHandler extends EventEmitter {
  private buffer: string = '';
  private tokens: string[] = [];
  private metrics: StreamingMetrics;
  private isStreaming: boolean = false;
  private logger: Logger;

  constructor(private requestId: string) {
    super();
    this.logger = new Logger('StreamingResponseHandler');
    this.metrics = {
      startTime: Date.now(),
      tokensReceived: 0,
      tokensPerSecond: 0,
      totalLatency: 0,
      errorCount: 0
    };
  }

  /**
   * Start streaming session
   */
  startStreaming(): void {
    this.isStreaming = true;
    this.metrics.startTime = Date.now();
    this.emit('streamStart', { requestId: this.requestId });
    this.logger.info(`Started streaming for request ${this.requestId}`);
  }

  /**
   * Process a new token chunk
   */
  processToken(chunk: string): void {
    if (!this.isStreaming) {
      this.logger.warn('Received token but streaming not started');
      return;
    }

    this.buffer += chunk;
    this.tokens.push(chunk);
    this.metrics.tokensReceived++;
    
    // Calculate tokens per second
    const elapsed = (Date.now() - this.metrics.startTime) / 1000;
    this.metrics.tokensPerSecond = this.metrics.tokensReceived / Math.max(elapsed, 0.001);
    
    // Emit token for real-time delivery
    const token: StreamingToken = {
      content: chunk,
      isComplete: false,
      index: this.tokens.length - 1
    };
    
    this.emit('token', token);
    this.emit('progress', {
      tokensReceived: this.metrics.tokensReceived,
      tokensPerSecond: this.metrics.tokensPerSecond
    });
  }

  /**
   * Complete streaming session and return final response
   */
  completeStreaming(metadata?: StreamingToken['metadata']): string {
    if (!this.isStreaming) {
      this.logger.warn('Attempting to complete non-active streaming session');
      return this.buffer;
    }

    this.isStreaming = false;
    this.metrics.totalLatency = Date.now() - this.metrics.startTime;
    
    const finalToken: StreamingToken = {
      content: '',
      isComplete: true,
      index: this.tokens.length,
      metadata
    };

    this.emit('token', finalToken);
    this.emit('streamComplete', {
      requestId: this.requestId,
      finalResponse: this.buffer,
      metrics: this.metrics,
      metadata
    });

    this.logger.info(`Completed streaming for request ${this.requestId}`, {
      tokens: this.metrics.tokensReceived,
      duration: this.metrics.totalLatency,
      tokensPerSecond: this.metrics.tokensPerSecond
    });

    return this.buffer;
  }

  /**
   * Handle streaming error
   */
  handleError(error: Error): void {
    this.metrics.errorCount++;
    this.isStreaming = false;
    
    this.emit('error', {
      requestId: this.requestId,
      error: error.message,
      metrics: this.metrics
    });
    
    this.logger.error(`Streaming error for request ${this.requestId}`, error);
  }

  /**
   * Get current streaming metrics
   */
  getMetrics(): StreamingMetrics {
    return { ...this.metrics };
  }

  /**
   * Get accumulated response
   */
  getResponse(): string {
    return this.buffer;
  }

  /**
   * Check if currently streaming
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.buffer = '';
    this.tokens = [];
    this.isStreaming = false;
    this.removeAllListeners();
    this.logger.info(`Cleaned up streaming handler for request ${this.requestId}`);
  }
}