/**
 * Queue Integration Layer - Connects JobQueueManager with existing MCP architecture
 * Provides seamless integration between main.ts, ModelOptimizer, and the queue system
 */

import { JobQueueManager, LLMJobData, OptimizationJobData } from './JobQueueManager.js';
import { ModelOptimizer } from '../services/ModelOptimizer.js';
import { CacheEngine } from '../core/CacheEngine.js';
import { Logger } from '../utils/Logger.js';

export interface QueueIntegrationConfig {
  enabled: boolean;
  maxConcurrency?: number;
  enableRateLimiting?: boolean;
  enableLoadBalancing?: boolean;
  enableCircuitBreaker?: boolean;
  enableAutoScaling?: boolean;
}

export class QueueIntegration {
  private jobQueueManager: JobQueueManager | null = null;
  private modelOptimizer: ModelOptimizer;
  private cacheEngine: CacheEngine;
  private logger: Logger;
  private config: QueueIntegrationConfig;

  constructor(
    modelOptimizer: ModelOptimizer,
    cacheEngine: CacheEngine,
    config: QueueIntegrationConfig
  ) {
    this.modelOptimizer = modelOptimizer;
    this.cacheEngine = cacheEngine;
    this.config = config;
    this.logger = new Logger('QueueIntegration');

    if (config.enabled) {
      this.initializeQueueSystem();
    }
  }

  private initializeQueueSystem(): void {
    this.jobQueueManager = new JobQueueManager(this.modelOptimizer, {
      maxConcurrency: this.config.maxConcurrency,
      enableRateLimiting: this.config.enableRateLimiting,
      enableLoadBalancing: this.config.enableLoadBalancing,
      enableCircuitBreaker: this.config.enableCircuitBreaker,
      enableAutoScaling: this.config.enableAutoScaling
    });

    this.logger.info('Queue system initialized', this.config);
  }

  /**
   * Process LLM requests through the queue system
   */
  async processLLMRequest(
    prompt: string,
    context?: string,
    options: {
      model?: string;
      taskType?: string;
      quality?: 'fast' | 'balanced' | 'premium';
      budget?: number;
      priority?: number;
      forceQueue?: boolean;
    } = {}
  ): Promise<any> {
    if (!this.jobQueueManager || !this.config.enabled) {
      // Fallback to direct processing
      return this.processDirectLLM(prompt, context, options);
    }

    const jobData: LLMJobData = {
      prompt,
      context,
      model: options.model,
      taskType: options.taskType,
      quality: options.quality,
      budget: options.budget,
      priority: options.priority || 5
    };

    try {
      const jobId = await this.jobQueueManager.submitLLMRequest(jobData, options.priority || 5);
      this.logger.debug('LLM request queued', { jobId, promptLength: prompt.length });
      
      const result = await this.jobQueueManager.waitForJob(jobId);
      return result;
    } catch (error) {
      this.logger.error('Queue processing failed, falling back to direct', error);
      return this.processDirectLLM(prompt, context, options);
    }
  }

  /**
   * Process model optimization through the queue system
   */
  async processModelOptimization(
    prompt: string,
    context?: string,
    options: {
      taskType?: string;
      quality?: 'fast' | 'balanced' | 'premium';
      budget?: number;
      priority?: number;
    } = {}
  ): Promise<any> {
    if (!this.jobQueueManager || !this.config.enabled) {
      // Fallback to direct processing
      return this.processDirectOptimization(prompt, context, options);
    }

    const jobData: OptimizationJobData = {
      prompt,
      context,
      taskType: options.taskType,
      quality: options.quality,
      budget: options.budget
    };

    try {
      const jobId = await this.jobQueueManager.submitOptimizationRequest(jobData, options.priority || 7);
      this.logger.debug('Optimization request queued', { jobId });
      
      const result = await this.jobQueueManager.waitForJob(jobId);
      return result;
    } catch (error) {
      this.logger.error('Queue optimization failed, falling back to direct', error);
      return this.processDirectOptimization(prompt, context, options);
    }
  }

  /**
   * Direct processing fallback methods
   */
  private async processDirectLLM(
    prompt: string,
    context?: string,
    options: any = {}
  ): Promise<any> {
    const promptTokens = Math.ceil(prompt.length / 4.5);
    const contextTokens = context ? Math.ceil(context.length / 4.5) : 0;
    
    const optimization = this.modelOptimizer.optimizeModelSelection(
      options.taskType || 'general',
      promptTokens,
      contextTokens,
      options.quality || 'balanced',
      options.budget
    );

    return {
      optimization,
      tokens: { prompt: promptTokens, context: contextTokens },
      processingTime: 0,
      processed: 'direct'
    };
  }

  private async processDirectOptimization(
    prompt: string,
    context?: string,
    options: any = {}
  ): Promise<any> {
    const promptTokens = Math.ceil(prompt.length / 4.5);
    const contextTokens = context ? Math.ceil(context.length / 4.5) : 0;
    
    const optimization = this.modelOptimizer.optimizeModelSelection(
      options.taskType || 'general',
      promptTokens,
      contextTokens,
      options.quality || 'balanced',
      options.budget
    );

    return {
      optimization,
      analysis: {
        promptTokens,
        contextTokens,
        totalTokens: promptTokens + contextTokens,
        processingTime: 0,
        processed: 'direct'
      }
    };
  }

  /**
   * Cache integration methods
   */
  async processCacheOperation(
    operation: 'get' | 'set' | 'delete' | 'cleanup',
    key: string,
    value?: any,
    ttl?: number
  ): Promise<any> {
    if (!this.jobQueueManager || !this.config.enabled) {
      // Direct cache operation - simplified
      if (operation === 'get') {
        return await this.cacheEngine.get(key);
      } else if (operation === 'set') {
        return await this.cacheEngine.set(key, value);
      } else if (operation === 'cleanup') {
        return await this.cacheEngine.cleanup();
      }
      return null;
    }

    const jobData = {
      operation,
      key,
      value,
      ttl
    };

    const jobId = await this.jobQueueManager.submitCacheOperation(jobData, 3);
    return await this.jobQueueManager.waitForJob(jobId);
  }

  /**
   * Batch processing methods
   */
  async processBatch(
    requests: Array<{
      prompt: string;
      context?: string;
      options?: any;
    }>
  ): Promise<any[]> {
    if (!this.jobQueueManager || !this.config.enabled) {
      // Process directly
      return Promise.all(
        requests.map(req => this.processDirectLLM(req.prompt, req.context, req.options))
      );
    }

    const jobs = requests.map(req => ({
      type: 'llm_request' as const,
      data: {
        prompt: req.prompt,
        context: req.context,
        ...req.options
      },
      priority: req.options?.priority || 5
    }));

    const jobIds = await this.jobQueueManager.submitBatch(jobs);
    
    return Promise.all(
      jobIds.map(jobId => this.jobQueueManager!.waitForJob(jobId))
    );
  }

  /**
   * Queue monitoring and management
   */
  getQueueStatus() {
    return this.jobQueueManager?.getQueueStatus() || {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      workers: []
    };
  }

  getMetrics() {
    return this.jobQueueManager?.getMetrics() || {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      activeJobs: 0,
      waitingJobs: 0,
      avgProcessingTime: 0,
      avgWaitTime: 0,
      throughputPerMinute: 0,
      errorRate: 0,
      workerUtilization: {},
      rateLimitHits: 0,
      circuitBreakerTrips: 0,
      autoScalingEvents: 0,
      loadBalancingDecisions: 0,
      workerHealth: {},
      systemLoad: { cpu: 0, memory: 0, queuePressure: 0 }
    };
  }

  /**
   * Health check for the queue system
   */
  async healthCheck(): Promise<{
    enabled: boolean;
    status: 'healthy' | 'degraded' | 'unhealthy';
    queueStatus: ReturnType<JobQueueManager['getQueueStatus']>;
    metrics: ReturnType<JobQueueManager['getMetrics']>;
  }> {
    if (!this.jobQueueManager || !this.config.enabled) {
      return {
        enabled: false,
        status: 'healthy',
        queueStatus: this.getQueueStatus(),
        metrics: this.getMetrics()
      };
    }

    const queueHealth = await this.jobQueueManager.healthCheck();
    
    return {
      enabled: true,
      status: queueHealth.status,
      queueStatus: queueHealth.queueStatus,
      metrics: queueHealth.metrics
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.jobQueueManager) {
      await this.jobQueueManager.shutdown();
    }
    this.logger.info('Queue integration shutdown complete');
  }

  /**
   * Dynamic configuration updates
   */
  updateConfig(newConfig: Partial<QueueIntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled && !this.jobQueueManager) {
        this.initializeQueueSystem();
      } else if (!newConfig.enabled && this.jobQueueManager) {
        this.shutdown();
        this.jobQueueManager = null;
      }
    }
    
    this.logger.info('Queue configuration updated', this.config);
  }

  /**
   * Get queue statistics for monitoring
   */
  getQueueStats(): {
    enabled: boolean;
    totalProcessed: number;
    currentQueueSize: number;
    averageProcessingTime: number;
    errorRate: number;
    workerCount: number;
  } {
    const metrics = this.getMetrics();
    
    return {
      enabled: this.config.enabled,
      totalProcessed: metrics.completedJobs + metrics.failedJobs,
      currentQueueSize: metrics.waitingJobs + metrics.activeJobs,
      averageProcessingTime: metrics.avgProcessingTime,
      errorRate: metrics.errorRate,
      workerCount: Object.keys(metrics.workerUtilization).length
    };
  }
}

export default QueueIntegration;