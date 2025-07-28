/**
 * Job Queue Manager - Integrates between main.ts and ModelOptimizer
 * Provides BullMQ-style job processing with high-concurrency support
 */

import { HighConcurrencyQueue, QueueJob, QueueWorker } from './HighConcurrencyQueue.js';
import { ModelOptimizer } from '../services/ModelOptimizer.js';
import { Logger } from '../utils/Logger.js';

export interface JobQueueConfig {
  maxConcurrency?: number;
  enableRateLimiting?: boolean;
  enableLoadBalancing?: boolean;
  enableCircuitBreaker?: boolean;
  enableAutoScaling?: boolean;
}

export interface LLMJobData {
  prompt: string;
  context?: string;
  model?: string;
  taskType?: string;
  quality?: 'fast' | 'balanced' | 'premium';
  budget?: number;
  priority?: number;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface OptimizationJobData {
  prompt: string;
  context?: string;
  taskType?: string;
  budget?: number;
  quality?: 'fast' | 'balanced' | 'premium';
}

export interface CacheJobData {
  key: string;
  operation: 'get' | 'set' | 'delete' | 'cleanup';
  value?: any;
  ttl?: number;
}

export class JobQueueManager {
  private queue: HighConcurrencyQueue;
  private modelOptimizer: ModelOptimizer;
  private logger: Logger;
  private workerIds: Map<string, string> = new Map();

  constructor(modelOptimizer: ModelOptimizer, config: JobQueueConfig = {}) {
    this.modelOptimizer = modelOptimizer;
    this.logger = new Logger('JobQueueManager');
    
    this.queue = new HighConcurrencyQueue({
      maxConcurrency: config.maxConcurrency || 10,
      rateLimit: config.enableRateLimiting ? {
        windowMs: 60000,
        maxRequests: 100,
        keyGenerator: (job) => this.generateRateLimitKey(job)
      } : undefined,
      loadBalancing: config.enableLoadBalancing ? {
        strategy: 'least-connections',
        healthCheck: {
          enabled: true,
          interval: 30000,
          timeout: 5000
        }
      } : undefined,
      circuitBreaker: config.enableCircuitBreaker ? {
        failureThreshold: 5,
        resetTimeout: 30000,
        monitoringPeriod: 60000
      } : undefined,
      autoScaling: config.enableAutoScaling ? {
        enabled: true,
        minWorkers: 1,
        maxWorkers: 10,
        scaleUpThreshold: 50,
        scaleDownThreshold: 30000,
        metricsWindow: 60000
      } : undefined
    });

    this.setupWorkers();
    this.setupEventHandlers();
  }

  /**
   * Setup workers for different job types
   */
  private setupWorkers(): void {
    // LLM Request Worker
    const llmWorkerId = this.queue.registerWorker(
      'llm_request',
      async (job: QueueJob) => {
        const data = job.data as LLMJobData;
        return await this.processLLMRequest(data);
      },
      {
        concurrency: 3,
        weight: 1,
        healthCheck: async () => {
          // Simple health check - could be enhanced
          return true;
        }
      }
    );
    this.workerIds.set('llm_request', llmWorkerId);

    // Model Optimization Worker
    const optimizationWorkerId = this.queue.registerWorker(
      'model_optimization',
      async (job: QueueJob) => {
        const data = job.data as OptimizationJobData;
        return await this.processModelOptimization(data);
      },
      {
        concurrency: 2,
        weight: 2
      }
    );
    this.workerIds.set('model_optimization', optimizationWorkerId);

    // Cache Operation Worker
    const cacheWorkerId = this.queue.registerWorker(
      'cache_miss',
      async (job: QueueJob) => {
        const data = job.data as CacheJobData;
        return await this.processCacheOperation(data);
      },
      {
        concurrency: 5,
        weight: 1
      }
    );
    this.workerIds.set('cache_miss', cacheWorkerId);

    // Cleanup Worker
    const cleanupWorkerId = this.queue.registerWorker(
      'cleanup',
      async (job: QueueJob) => {
        return await this.processCleanup(job.data);
      },
      {
        concurrency: 1,
        weight: 1
      }
    );
    this.workerIds.set('cleanup', cleanupWorkerId);
  }

  /**
   * Setup event handlers for monitoring and debugging
   */
  private setupEventHandlers(): void {
    this.queue.on('job:started', (job) => {
      this.logger.debug('Job started', { jobId: job.id, type: job.type });
    });

    this.queue.on('job:completed', (job, result) => {
      this.logger.debug('Job completed', { jobId: job.id, type: job.type, duration: Date.now() - (job.startedAt || 0) });
    });

    this.queue.on('job:failed', (job, error) => {
      this.logger.error('Job failed', { jobId: job.id, type: job.type, error: error.message });
    });

    this.queue.on('job:retry', (job, error) => {
      this.logger.warn('Job retry scheduled', { jobId: job.id, attempt: job.attempts, error: error.message });
    });

    this.queue.on('scaling:needed', (data) => {
      this.logger.info('Auto-scaling triggered', data);
    });

    this.queue.on('metrics:updated', (metrics) => {
      this.logger.debug('Queue metrics updated', {
        waiting: metrics.waitingJobs,
        active: metrics.activeJobs,
        throughput: metrics.throughputPerMinute
      });
    });
  }

  /**
   * Process LLM requests with optimization
   */
  private async processLLMRequest(data: LLMJobData): Promise<any> {
    const startTime = Date.now();
    
    try {
      // Estimate tokens
      const promptTokens = Math.ceil(data.prompt.length / 4.5);
      const contextTokens = data.context ? Math.ceil(data.context.length / 4.5) : 0;
      
      // Get optimization strategy
      const optimization = this.modelOptimizer.optimizeModelSelection(
        data.taskType || 'general',
        promptTokens,
        contextTokens,
        data.quality || 'balanced',
        data.budget
      );

      this.logger.debug('Model optimization applied', {
        originalModel: data.model,
        optimizedModel: optimization.model,
        expectedSavings: optimization.expectedSavings
      });

      return {
        optimization,
        tokens: { prompt: promptTokens, context: contextTokens },
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      this.logger.error('LLM request processing failed', error);
      throw error;
    }
  }

  /**
   * Process model optimization requests
   */
  private async processModelOptimization(data: OptimizationJobData): Promise<any> {
    const startTime = Date.now();
    
    try {
      const promptTokens = Math.ceil(data.prompt.length / 4.5);
      const contextTokens = data.context ? Math.ceil(data.context.length / 4.5) : 0;
      
      const optimization = this.modelOptimizer.optimizeModelSelection(
        data.taskType || 'general',
        promptTokens,
        contextTokens,
        data.quality || 'balanced',
        data.budget
      );

      return {
        optimization,
        analysis: {
          promptTokens,
          contextTokens,
          totalTokens: promptTokens + contextTokens,
          processingTime: Date.now() - startTime
        }
      };
    } catch (error) {
      this.logger.error('Model optimization failed', error);
      throw error;
    }
  }

  /**
   * Process cache operations
   */
  private async processCacheOperation(data: CacheJobData): Promise<any> {
    // This would integrate with the actual cache system
    // For now, return mock data
    return {
      operation: data.operation,
      key: data.key,
      success: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Process cleanup operations
   */
  private async processCleanup(data: any): Promise<any> {
    // This would handle cleanup tasks
    return {
      operation: 'cleanup',
      data,
      completed: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate rate limit key based on job data
   */
  private generateRateLimitKey(job: QueueJob): string {
    const data = job.data;
    const userId = data.userId || data.sessionId || 'anonymous';
    return `${job.type}:${userId}`;
  }

  /**
   * Public API methods
   */

  async submitLLMRequest(data: LLMJobData, priority: number = 5): Promise<string> {
    return await this.queue.add('llm_request', data, { priority });
  }

  async submitOptimizationRequest(data: OptimizationJobData, priority: number = 7): Promise<string> {
    return await this.queue.add('model_optimization', data, { priority });
  }

  async submitCacheOperation(data: CacheJobData, priority: number = 3): Promise<string> {
    return await this.queue.add('cache_miss', data, { priority });
  }

  async submitCleanup(data: any, priority: number = 1): Promise<string> {
    return await this.queue.add('cleanup', data, { priority });
  }

  /**
   * Get queue status and metrics
   */
  getQueueStatus() {
    return this.queue.getQueueStatus();
  }

  getMetrics() {
    return this.queue.getMetrics();
  }

  /**
   * Wait for job completion
   */
  async waitForJob(jobId: string, timeout: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Job ${jobId} timed out after ${timeout}ms`));
      }, timeout);

      const onComplete = (job: QueueJob, result: any) => {
        if (job.id === jobId) {
          clearTimeout(timeoutId);
          this.queue.off('job:completed', onComplete);
          this.queue.off('job:failed', onFailed);
          resolve(result);
        }
      };

      const onFailed = (job: QueueJob, error: Error) => {
        if (job.id === jobId) {
          clearTimeout(timeoutId);
          this.queue.off('job:completed', onComplete);
          this.queue.off('job:failed', onFailed);
          reject(error);
        }
      };

      this.queue.on('job:completed', onComplete);
      this.queue.on('job:failed', onFailed);
    });
  }

  /**
   * Batch job submission
   */
  async submitBatch(jobs: Array<{
    type: QueueJob['type'];
    data: any;
    priority?: number;
  }>): Promise<string[]> {
    const jobIds: string[] = [];
    
    for (const job of jobs) {
      const jobId = await this.queue.add(job.type, job.data, { priority: job.priority });
      jobIds.push(jobId);
    }
    
    return jobIds;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down job queue manager...');
    await this.queue.shutdown();
    this.logger.info('Job queue manager shutdown complete');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queueStatus: ReturnType<JobQueueManager['getQueueStatus']>;
    metrics: ReturnType<JobQueueManager['getMetrics']>;
  }> {
    const queueStatus = this.getQueueStatus();
    const metrics = this.getMetrics();
    
    const unhealthyWorkers = queueStatus.workers.filter(w => w.health !== 'healthy');
    const queuePressure = queueStatus.waiting / 100;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (unhealthyWorkers.length > 0 || queuePressure > 0.8) {
      status = 'degraded';
    }
    
    if (unhealthyWorkers.length > queueStatus.workers.length / 2 || queuePressure > 1.5) {
      status = 'unhealthy';
    }
    
    return { status, queueStatus, metrics };
  }
}

export default JobQueueManager;