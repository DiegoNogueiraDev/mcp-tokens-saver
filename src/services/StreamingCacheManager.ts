import { CacheEngine } from '../core/CacheEngine.js';
import { StreamingResponseHandler } from '../handlers/StreamingResponseHandler.js';
import { Logger } from '../utils/Logger.js';
import { CacheDecision } from '../types/index.js';

export interface StreamingCacheOptions {
  enableCache: boolean;
  cacheKey: string;
  model: string;
  estimatedTokens: number;
}

export class StreamingCacheManager {
  private cacheEngine: CacheEngine;
  private logger: Logger;

  constructor(cacheEngine: CacheEngine) {
    this.cacheEngine = cacheEngine;
    this.logger = new Logger('StreamingCacheManager');
  }

  /**
   * Check if we should use cache for this streaming request
   */
  async shouldCache(options: StreamingCacheOptions): Promise<CacheDecision> {
    if (!options.enableCache) {
      return {
        shouldCache: false,
        reason: 'Cache disabled for streaming request',
        estimatedSavings: 0,
        ttl: 0
      };
    }

    // Check if we have a cached response
    const cached = await this.cacheEngine.get(options.cacheKey);
    if (cached && cached.value) {
      return {
        shouldCache: false,
        reason: 'Response already cached',
        estimatedSavings: 0,
        ttl: 0
      };
    }

    // Use cache heuristics for streaming responses
    const decision = this.cacheEngine.shouldCache(options.cacheKey, '', '');
    
    return decision;
  }

  /**
   * Cache the complete response after streaming finishes
   */
  async cacheCompleteResponse(
    cacheKey: string,
    response: string,
    options: {
      model: string;
      tokens: number;
      tags?: string[];
    }
  ): Promise<void> {
    try {
      // Only cache complete responses, not partial tokens
      if (!response || response.trim().length === 0) {
        this.logger.warn('Empty response, not caching');
        return;
      }

      await this.cacheEngine.set(response, {
        context: cacheKey,
        model: options.model,
        tokens: options.tokens,
        tags: options.tags
      });

      this.logger.info('Cached complete streaming response', {
        cacheKey,
        model: options.model,
        tokens: options.tokens,
        responseLength: response.length
      });
    } catch (error) {
      this.logger.error('Failed to cache streaming response', error);
      // Don't throw - caching failure shouldn't break the response
    }
  }

  /**
   * Handle streaming completion and cache the final response
   */
  async handleStreamingCompletion(
    handler: StreamingResponseHandler,
    cacheOptions: StreamingCacheOptions,
    response: string,
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    }
  ): Promise<void> {
    if (!cacheOptions.enableCache) {
      return;
    }

    const actualTokens = usage?.completion_tokens || Math.ceil(response.length / 4);
    
    await this.cacheCompleteResponse(cacheOptions.cacheKey, response, {
      model: cacheOptions.model,
      tokens: actualTokens
    });

    this.logger.info('Streaming response cached successfully', {
      cacheKey: cacheOptions.cacheKey,
      model: cacheOptions.model,
      tokens: actualTokens,
      responseLength: response.length
    });
  }

  /**
   * Get cached response if available (for non-streaming fallback)
   */
  async getCachedResponse(cacheKey: string): Promise<string | null> {
    try {
      const cached = await this.cacheEngine.get(cacheKey);
      if (cached && cached.value) {
        this.logger.info('Cache hit for streaming request', { cacheKey });
        return cached.value;
      }
      return null;
    } catch (error) {
      this.logger.error('Failed to get cached response', error);
      return null;
    }
  }

  /**
   * Generate cache key for streaming request
   */
  generateCacheKey(
    model: string,
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>,
    temperature?: number,
    max_tokens?: number
  ): string {
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    const params = `t${temperature || 0.7}_m${max_tokens || 2048}`;
    return `stream_${model}_${Buffer.from(content).toString('base64').slice(0, 32)}_${params}`;
  }

  /**
   * Clean up any temporary streaming state
   */
  async cleanup(): Promise<void> {
    // No temporary state to clean up - streaming responses are only cached when complete
    this.logger.debug('Streaming cache manager cleanup completed');
  }
}