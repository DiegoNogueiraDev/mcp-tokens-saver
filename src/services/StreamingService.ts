import { StreamingLLMProvider } from '../providers/StreamingLLMProvider.js';
import { StreamingCacheManager } from './StreamingCacheManager.js';
import { SSEHandler } from '../handlers/SSEHandler.js';
import { StreamingResponseHandler } from '../handlers/StreamingResponseHandler.js';
import { LLMProviderFactory } from '../providers/LLMProviderFactory.js';
import { CacheEngine } from '../core/CacheEngine.js';
import { Logger } from '../utils/Logger.js';
import { TaskType } from '../types/index.js';

export interface StreamingRequest {
  model?: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  useCache?: boolean;
  taskType?: TaskType;
  tags?: string[];
}

export interface StreamingResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cached?: boolean;
  model: string;
  metrics?: {
    duration: number;
    tokens_per_second: number;
  };
}

export class StreamingService {
  private streamingProvider: StreamingLLMProvider;
  private cacheManager: StreamingCacheManager;
  private sseHandler: SSEHandler;
  private providerFactory: LLMProviderFactory;
  private logger: Logger;

  constructor(cacheEngine: CacheEngine) {
    this.streamingProvider = new StreamingLLMProvider();
    this.cacheManager = new StreamingCacheManager(cacheEngine);
    this.sseHandler = new SSEHandler();
    this.providerFactory = new LLMProviderFactory();
    this.logger = new Logger('StreamingService');
  }

  /**
   * Main streaming method - handles both SSE and direct streaming
   */
  async stream(request: StreamingRequest, requestId: string): Promise<StreamingResponse> {
    const startTime = Date.now();
    
    try {
      // Determine model to use
      const modelName = request.model || 'moonshot-v1-8k';
      const providerConfig = this.providerFactory.getProviderConfig(modelName);
      
      if (!providerConfig) {
        throw new Error(`Model ${modelName} not found`);
      }

      // Generate cache key
      const cacheKey = this.cacheManager.generateCacheKey(
        modelName,
        request.messages,
        request.temperature,
        request.max_tokens
      );

      // Check cache first (for non-streaming or cached responses)
      if (request.useCache !== false) {
        const cached = await this.cacheManager.getCachedResponse(cacheKey);
        if (cached) {
          return {
            content: cached,
            model: modelName,
            cached: true,
            metrics: {
              duration: Date.now() - startTime,
              tokens_per_second: 0
            }
          };
        }
      }

      // Create streaming handler
      const handler = new StreamingResponseHandler(requestId);
      
      // Check if we should cache this response
      const cacheDecision = await this.cacheManager.shouldCache({
        enableCache: request.useCache !== false,
        cacheKey,
        model: modelName,
        estimatedTokens: this.estimateTokens(request.messages)
      });

      // Start streaming
      const streamingRequest = {
        model: modelName,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
        requestId
      };

      const response = await this.streamingProvider.streamResponse(
        providerConfig.provider,
        providerConfig.model,
        streamingRequest,
        handler
      );

      // Cache complete response if enabled
      if (cacheDecision.shouldCache) {
        await this.cacheManager.handleStreamingCompletion(
          handler,
          {
            enableCache: true,
            cacheKey,
            model: modelName,
            estimatedTokens: response.usage?.completion_tokens || 0
          },
          response.content,
          response.usage
        );
      }

      return {
        content: response.content,
        usage: response.usage,
        model: modelName,
        cached: false,
        metrics: {
          duration: Date.now() - startTime,
          tokens_per_second: response.usage 
            ? response.usage.completion_tokens / ((Date.now() - startTime) / 1000)
            : 0
        }
      };

    } catch (error) {
      this.logger.error('Streaming error', { requestId, error });
      throw error;
    }
  }

  /**
   * Handle SSE streaming for web clients
   */
  async streamWithSSE(request: StreamingRequest, requestId: string, response: any): Promise<void> {
    const handler = this.sseHandler.handleConnection(requestId, response);
    
    try {
      // Process the request in the background
      this.stream(request, requestId).then(result => {
        // The SSE handler will handle completion via events
      }).catch(error => {
        handler.handleError(error);
      });
      
    } catch (error) {
      handler.handleError(error as Error);
    }
  }

  /**
   * Non-streaming fallback for backward compatibility
   */
  async generate(request: Omit<StreamingRequest, 'stream'> & { model?: string }): Promise<StreamingResponse> {
    const startTime = Date.now();
    
    try {
      const modelName = request.model || 'moonshot-v1-8k';
      const providerConfig = this.providerFactory.getProviderConfig(modelName);
      
      if (!providerConfig) {
        throw new Error(`Model ${modelName} not found`);
      }

      // Check cache
      const cacheKey = this.cacheManager.generateCacheKey(
        modelName,
        request.messages,
        request.temperature,
        request.max_tokens
      );

      if (request.useCache !== false) {
        const cached = await this.cacheManager.getCachedResponse(cacheKey);
        if (cached) {
          return {
            content: cached,
            model: modelName,
            cached: true,
            metrics: {
              duration: Date.now() - startTime,
              tokens_per_second: 0
            }
          };
        }
      }

      // Generate response
      const response = await this.streamingProvider.generateResponse(
        providerConfig.provider,
        providerConfig.model,
        {
          model: modelName,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens
        }
      );

      // Cache response
      if (request.useCache !== false) {
        await this.cacheManager.cacheCompleteResponse(
          cacheKey,
          response.content,
          {
            model: modelName,
            tokens: response.usage?.completion_tokens || 0,
            tags: request.tags
          }
        );
      }

      return {
        content: response.content,
        usage: response.usage,
        model: modelName,
        cached: false,
        metrics: {
          duration: Date.now() - startTime,
          tokens_per_second: response.usage 
            ? response.usage.completion_tokens / ((Date.now() - startTime) / 1000)
            : 0
        }
      };

    } catch (error) {
      this.logger.error('Generation error', { error });
      throw error;
    }
  }

  /**
   * Get streaming metrics
   */
  getMetrics() {
    return {
      sse: this.sseHandler.getMetrics(),
      cache: this.cacheManager // Add cache metrics when available
    };
  }

  /**
   * Get SSE handler for web server integration
   */
  getSSEHandler(): SSEHandler {
    return this.sseHandler;
  }

  /**
   * Estimate tokens for request
   */
  private estimateTokens(messages: Array<{ content: string }>): number {
    return messages.reduce((total, msg) => total + Math.ceil(msg.content.length / 4), 0);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<any> {
    return {
      streaming: true,
      sse: this.sseHandler.healthCheck(),
      providers: this.providerFactory.getAllProviders().length,
      models: this.providerFactory.getAllModels().length
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.sseHandler.shutdown();
    await this.cacheManager.cleanup();
    this.logger.info('Streaming service cleaned up');
  }
}