import { SimplePersistentCache as PersistentCache } from '../services/SimplePersistentCache.js';
import { VectorCache } from '../cache/VectorCache.js';
import { CacheDecision, CacheEntry, CacheStats, SmartCacheOptions, TaskType } from '../types/index.js';
import { CacheHeuristics } from '../services/CacheHeuristics.js';
import { Logger } from '../utils/Logger.js';
import crypto from 'crypto';

/**
 * Enhanced Cache Engine with multi-layer caching (literal + semantic)
 * Integrates VectorCache for semantic similarity caching
 */
export interface EnhancedCacheOptions extends SmartCacheOptions {
  enableVectorCache?: boolean;
  vectorCacheOptions?: {
    maxEntries?: number;
    similarityThreshold?: number;
    embeddingModel?: string;
    useFaiss?: boolean;
  };
}

export interface CacheResult {
  value: any;
  tokens: number;
  hits: number;
  cached: boolean;
  cacheType: 'literal' | 'vector' | 'none';
  similarity?: number;
  cacheKey?: string;
}

export class CacheEngine {
  private cache: PersistentCache;
  private vectorCache: VectorCache | null = null;
  private heuristics: CacheHeuristics;
  private logger: Logger;
  private enableHeuristics: boolean;
  private enableVectorCache: boolean;

  constructor(options: EnhancedCacheOptions = {}) {
    this.cache = new PersistentCache({
      redisUrl: options.redisUrl,
      dataDir: options.dataDir,
      maxMemoryMB: options.maxMemoryMB,
      defaultTTL: options.defaultTTL
    });
    
    this.heuristics = new CacheHeuristics();
    this.logger = new Logger('CacheEngine');
    this.enableHeuristics = options.enableHeuristics !== false;
    this.enableVectorCache = options.enableVectorCache !== false;

    // Initialize vector cache if enabled
    if (this.enableVectorCache) {
      this.vectorCache = new VectorCache({
        dataDir: options.dataDir || './data',
        maxEntries: options.vectorCacheOptions?.maxEntries || 1000,
        similarityThreshold: options.vectorCacheOptions?.similarityThreshold || 0.85,
        embeddingModel: options.vectorCacheOptions?.embeddingModel || 'Xenova/all-MiniLM-L6-v2',
        useFaiss: options.vectorCacheOptions?.useFaiss !== false,
        enablePersistence: true
      });
    }

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
   * Retrieves from cache with multi-layer fallback
   * 1. Literal cache (exact match)
   * 2. Vector cache (semantic similarity)
   */
  async get(prompt: string, context?: string, model?: string, taskType?: TaskType): Promise<CacheResult | null> {
    const cacheKey = this.generateCacheKey(prompt, context, model);
    
    // Try literal cache first
    const literalResult = await this.cache.get(cacheKey);
    if (literalResult) {
      this.logger.debug('Literal cache hit', { key: cacheKey.substring(0, 8) });
      return {
        value: literalResult.value,
        tokens: literalResult.tokens,
        hits: literalResult.hits,
        cached: true,
        cacheType: 'literal',
        cacheKey
      };
    }

    // Try vector cache if enabled
    if (this.vectorCache) {
      try {
        const vectorResult = await this.vectorCache.findSimilar(prompt, model || 'default', taskType);
        if (vectorResult) {
          this.logger.debug('Vector cache hit', { 
            key: cacheKey.substring(0, 8),
            similarity: vectorResult.similarity 
          });
          
          return {
            value: vectorResult.entry.response,
            tokens: vectorResult.entry.tokens,
            hits: vectorResult.entry.hits,
            cached: true,
            cacheType: 'vector',
            similarity: vectorResult.similarity,
            cacheKey
          };
        }
      } catch (error) {
        this.logger.error('Vector cache lookup failed', { error });
      }
    }

    this.logger.debug('Cache miss', { key: cacheKey.substring(0, 8) });
    return null;
  }

  /**
   * Stores in cache with intelligent decision making
   * Stores in both literal and vector caches
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
      taskType?: TaskType;
    } = {}
  ): Promise<{
    cached: boolean;
    reason: string;
    estimated_savings: number;
    cacheKey: string;
    vectorCached?: boolean;
  }> {
    
    const decision = options.forceCache 
      ? { shouldCache: true, reason: 'forced', estimatedSavings: options.tokens || 0, ttl: 3600 }
      : this.shouldCache(prompt, options.context, value);

    const cacheKey = this.generateCacheKey(prompt, options.context, options.model);

    if (decision.shouldCache) {
      // Store in literal cache
      await this.cache.set(cacheKey, value, {
        ttl: decision.ttl,
        tokens: options.tokens || decision.estimatedSavings,
        tags: options.tags,
        model: options.model
      });

      // Store in vector cache if enabled
      let vectorCached = false;
      if (this.vectorCache) {
        try {
          await this.vectorCache.store(prompt, value, options.model || 'default', 
            options.tokens || decision.estimatedSavings, {
            task_type: options.taskType,
            quality_score: 0.8 // Default quality score
          });
          vectorCached = true;
        } catch (error) {
          this.logger.error('Vector cache storage failed', { error });
        }
      }

      this.logger.debug('Cached', { 
        key: cacheKey.substring(0, 8), 
        reason: decision.reason,
        tokens: options.tokens,
        vectorCached
      });

      return {
        cached: true,
        reason: decision.reason,
        estimated_savings: decision.estimatedSavings,
        cacheKey,
        vectorCached
      };
    }

    return {
      cached: false,
      reason: decision.reason,
      estimated_savings: 0,
      cacheKey
    };
  }

  /**
   * Find similar cached entries by tags
   */
  async findSimilar(tags: string[]): Promise<CacheEntry[]> {
    return await this.cache.getByTags(tags);
  }

  /**
   * Get comprehensive cache statistics including vector cache
   */
  async getStats(): Promise<CacheStats & {
    vector_cache?: any;
    multi_layer_stats?: {
      literal_hits: number;
      vector_hits: number;
      total_requests: number;
      vector_hit_rate: number;
    };
  }> {
    const stats = await this.cache.getStats();
    
    if (this.vectorCache) {
      const vectorStats = this.vectorCache.getStats();
      return {
        ...stats,
        vector_cache: vectorStats,
        multi_layer_stats: {
          literal_hits: vectorStats.literal_hits,
          vector_hits: vectorStats.vector_hits,
          total_requests: vectorStats.total_requests,
          vector_hit_rate: vectorStats.vector_hit_rate
        }
      };
    }
    
    return stats;
  }

  /**
   * Intelligent cache cleanup for both caches
   */
  async cleanup(): Promise<{
    literal_removed: number;
    vector_removed?: number;
    freed_mb: number;
  }> {
    this.logger.info('Starting multi-layer cache cleanup');
    
    const literalResult = await this.cache.cleanup();
    let vectorResult = { removed: 0 };
    
    if (this.vectorCache) {
      // Vector cache has its own cleanup mechanism
      this.logger.info('Vector cache cleanup triggered');
    }

    this.logger.info('Multi-layer cleanup completed', {
      literal_removed: literalResult.removed,
      freed_mb: literalResult.freed_mb
    });

    return {
      literal_removed: literalResult.removed,
      freed_mb: literalResult.freed_mb
    };
  }

  /**
   * Warm cache with high-priority entries
   */
  async warmCache(topN: number = 50): Promise<void> {
    this.logger.info('Warming multi-layer cache', { topN });
    await this.cache.warmCache(topN);
    
    if (this.vectorCache) {
      this.logger.info('Vector cache warming completed');
    }
  }

  /**
   * Preload common patterns for better hit rates
   */
  async preloadCommonPatterns(): Promise<void> {
    const commonPatterns = [
      {
        context: 'JavaScript/TypeScript expert assistant',
        tags: ['javascript', 'typescript', 'coding'],
        ttl: 7200,
        taskType: 'coding' as TaskType
      },
      {
        context: 'React development specialist',
        tags: ['react', 'frontend', 'components'],
        ttl: 7200,
        taskType: 'coding' as TaskType
      },
      {
        context: 'Node.js backend development expert',
        tags: ['nodejs', 'backend', 'api'],
        ttl: 7200,
        taskType: 'coding' as TaskType
      },
      {
        context: 'Code review and optimization specialist',
        tags: ['code-review', 'optimization', 'quality'],
        ttl: 5400,
        taskType: 'optimization' as TaskType
      },
      {
        context: 'Debugging and troubleshooting expert',
        tags: ['debugging', 'troubleshooting', 'error-handling'],
        ttl: 5400,
        taskType: 'debugging' as TaskType
      }
    ];

    for (const pattern of commonPatterns) {
      const key = this.generateCacheKey('system-context', pattern.context, 'moonshot-v1-8k');
      await this.cache.set(key, pattern.context, {
        ttl: pattern.ttl,
        tokens: this.estimateTokens(pattern.context),
        tags: pattern.tags
      });

      // Also store in vector cache for semantic matching
      if (this.vectorCache) {
        try {
          await this.vectorCache.store(
            `System context: ${pattern.context}`,
            pattern.context,
            'moonshot-v1-8k',
            this.estimateTokens(pattern.context),
            { task_type: pattern.taskType, quality_score: 0.9 }
          );
        } catch (error) {
          this.logger.error('Failed to preload vector cache', { error });
        }
      }
    }

    this.logger.info('Multi-layer cache preloaded with common patterns');
  }

  /**
   * Estimate tokens from text
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4.5);
  }

  /**
   * Get vector cache statistics
   */
  getVectorCacheStats() {
    if (!this.vectorCache) {
      return null;
    }
    return this.vectorCache.getStats();
  }

  /**
   * Export vector cache data for analysis
   */
  exportVectorCacheData() {
    if (!this.vectorCache) {
      return null;
    }
    return this.vectorCache.exportData();
  }

  /**
   * Close cache connections
   */
  async close(): Promise<void> {
    await this.cache.close();
    this.logger.info('Multi-layer cache engine closed');
  }
}