import { SimplePersistentCache as PersistentCache } from '../services/SimplePersistentCache.js';
import { CacheDecision, CacheEntry, CacheStats, SmartCacheOptions, TaskType } from '../types/index.js';
import { CacheHeuristics } from '../services/CacheHeuristics.js';
import { Logger } from '../utils/Logger.js';
import crypto from 'crypto';

/**
 * Core Cache Engine - Manages intelligent caching decisions and operations
 */
export class CacheEngine {
  private cache: PersistentCache;
  private heuristics: CacheHeuristics;
  private logger: Logger;
  private enableHeuristics: boolean;

  constructor(options: SmartCacheOptions = {}) {
    this.cache = new PersistentCache({
      redisUrl: options.redisUrl,
      dataDir: options.dataDir,
      maxMemoryMB: options.maxMemoryMB,
      defaultTTL: options.defaultTTL
    });
    
    this.heuristics = new CacheHeuristics();
    this.logger = new Logger('CacheEngine');
    this.enableHeuristics = options.enableHeuristics !== false;

    // Initialize cache warming
    setTimeout(() => {
      this.warmCache().catch(this.logger.error);
    }, 1000);
  }

  /**
   * Generates unique cache key based on content
   */
  generateCacheKey(prompt: string, context?: string, model?: string): string {
    const content = `${model || 'default'}:${context || ''}:${prompt}`;
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Intelligent caching decision
   */
  shouldCache(prompt: string, context?: string, response?: any): CacheDecision {
    if (!this.enableHeuristics) {
      return {
        shouldCache: true,
        reason: 'Heuristics disabled - cache all',
        estimatedSavings: 0,
        ttl: 3600
      };
    }

    return this.heuristics.evaluateCachingDecision(prompt, context, response);
  }

  /**
   * Retrieves from cache with intelligent fallback
   */
  async get(prompt: string, context?: string, model?: string): Promise<{
    value: any;
    tokens: number;
    hits: number;
    cached: boolean;
  } | null> {
    const cacheKey = this.generateCacheKey(prompt, context, model);
    const result = await this.cache.get(cacheKey);
    
    if (result) {
      this.logger.debug('Cache hit', { key: cacheKey.substring(0, 8) });
      return {
        ...result,
        cached: true
      };
    }
    
    this.logger.debug('Cache miss', { key: cacheKey.substring(0, 8) });
    return null;
  }

  /**
   * Stores in cache with intelligent decision making
   */
  async set(
    prompt: string,
    value: any,
    options: {
      context?: string;
      model?: string;
      tokens?: number;
      tags?: string[];
      forceCache?: boolean;
    } = {}
  ): Promise<{cached: boolean, reason: string, estimated_savings: number}> {
    
    const decision = options.forceCache 
      ? { shouldCache: true, reason: 'forced', estimatedSavings: options.tokens || 0, ttl: 3600 }
      : this.shouldCache(prompt, options.context, value);

    if (decision.shouldCache) {
      const cacheKey = this.generateCacheKey(prompt, options.context, options.model);
      
      await this.cache.set(cacheKey, value, {
        ttl: decision.ttl,
        tokens: options.tokens || decision.estimatedSavings,
        tags: options.tags,
        model: options.model
      });

      this.logger.debug('Cached', { 
        key: cacheKey.substring(0, 8), 
        reason: decision.reason,
        tokens: options.tokens 
      });

      return {
        cached: true,
        reason: decision.reason,
        estimated_savings: decision.estimatedSavings
      };
    }

    return {
      cached: false,
      reason: decision.reason,
      estimated_savings: 0
    };
  }

  /**
   * Find similar cached entries by tags
   */
  async findSimilar(tags: string[]): Promise<CacheEntry[]> {
    return await this.cache.getByTags(tags);
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<CacheStats> {
    return await this.cache.getStats();
  }

  /**
   * Intelligent cache cleanup
   */
  async cleanup(): Promise<{removed: number, freed_mb: number}> {
    this.logger.info('Starting intelligent cleanup');
    const result = await this.cache.cleanup();
    this.logger.info('Cleanup completed', result);
    return result;
  }

  /**
   * Warm cache with high-priority entries
   */
  async warmCache(topN: number = 50): Promise<void> {
    this.logger.info('Warming cache', { topN });
    await this.cache.warmCache(topN);
  }

  /**
   * Preload common patterns for better hit rates
   */
  async preloadCommonPatterns(): Promise<void> {
    const commonPatterns = [
      {
        context: 'JavaScript/TypeScript expert assistant',
        tags: ['javascript', 'typescript', 'coding'],
        ttl: 7200
      },
      {
        context: 'React development specialist',
        tags: ['react', 'frontend', 'components'],
        ttl: 7200
      },
      {
        context: 'Node.js backend development expert',
        tags: ['nodejs', 'backend', 'api'],
        ttl: 7200
      },
      {
        context: 'Code review and optimization specialist',
        tags: ['code-review', 'optimization', 'quality'],
        ttl: 5400
      }
    ];

    for (const pattern of commonPatterns) {
      const key = this.generateCacheKey('system-context', pattern.context, 'moonshot-v1-8k');
      await this.cache.set(key, pattern.context, {
        ttl: pattern.ttl,
        tokens: this.estimateTokens(pattern.context),
        tags: pattern.tags
      });
    }

    this.logger.info('Cache preloaded with common patterns');
  }

  /**
   * Estimate tokens from text
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4.5);
  }

  /**
   * Close cache connections
   */
  async close(): Promise<void> {
    await this.cache.close();
    this.logger.info('Cache engine closed');
  }
}