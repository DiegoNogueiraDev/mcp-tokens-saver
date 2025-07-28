/**
 * Enhanced Request Queue System - High-concurrency, load balancing, and monitoring
 * BullMQ-style implementation with Node.js native solutions
 * Handles thundering herd, rate limiting, and automatic scaling
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger.js';
import { RequestQueue, QueueJob, QueueWorker, QueueOptions, QueueMetrics } from './RequestQueue.js';

// Enhanced interfaces for high-concurrency support
export interface EnhancedQueueJob extends QueueJob {
  rateLimitKey?: string;
  retryBackoff?: 'exponential' | 'linear' | 'fixed';
  maxConcurrencyOverride?: number;
  circuitBreaker?: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  };
  loadBalancing?: {
    preferredWorker?: string;
    attemptsPerWorker: Map<string, number>;
  };
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (job: EnhancedQueueJob) => string;
}

export interface LoadBalancingConfig {
  strategy: 'round-robin' | 'least-connections' | 'weighted' | 'priority';
  weights?: Map<string, number>;
  healthCheck?: {
    enabled: boolean;
    interval: number;
    timeout: number;
  };
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export interface AutoScalingConfig {
  enabled: boolean;
  minWorkers: number;
  maxWorkers: number;
  scaleUpThreshold: number; // queue length
  scaleDownThreshold: number; // idle time
  metricsWindow: number; // ms
}

export interface EnhancedQueueOptions extends QueueOptions {
  rateLimit?: RateLimitConfig;
  loadBalancing?: LoadBalancingConfig;
  circuitBreaker?: CircuitBreakerConfig;
  autoScaling?: AutoScalingConfig;
  enableMetrics?: boolean;
  metricsRetention?: number; // ms
}

export interface EnhancedQueueMetrics extends QueueMetrics {
  rateLimitHits: number;
  circuitBreakerTrips: number;
  autoScalingEvents: number;
  loadBalancingDecisions: number;
  workerHealth: Map<string, {
    status: 'healthy' | 'unhealthy' | 'degraded';
    lastHealthCheck: number;
    failureRate: number;
    responseTime: number;
  }>;
  systemLoad: {
    cpu: number;
    memory: number;
    queuePressure: number;
  };
}

export class EnhancedRequestQueue extends RequestQueue {
  private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerConfig & { failures: number[] }> = new Map();
  private autoScaling: AutoScalingConfig;
  private loadBalancing: LoadBalancingConfig;
  private workerHealth: Map<string, EnhancedQueueMetrics['workerHealth'][string]> = new Map();
  private systemMetrics: EnhancedQueueMetrics['systemLoad'];
  private scalingInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsHistory: Array<EnhancedQueueMetrics & { timestamp: number }> = [];
  private semaphore: Map<string, number> = new Map(); // Thread safety
  private jobLocks: Map<string, string> = new Map(); // Prevent duplicate processing

  constructor(options: EnhancedQueueOptions = {}) {
    super(options);

    // Initialize enhanced configurations
    this.autoScaling = {
      enabled: true,
      minWorkers: 1,
      maxWorkers: 10,
      scaleUpThreshold: 50,
      scaleDownThreshold: 30000,
      metricsWindow: 60000,
      ...options.autoScaling
    };

    this.loadBalancing = {
      strategy: 'least-connections',
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000
      },
      ...options.loadBalancing
    };

    this.systemMetrics = {
      cpu: 0,
      memory: 0,
      queuePressure: 0
    };

    this.initializeEnhancedFeatures();
  }

  /**
   * Initialize enhanced queue features
   */
  private initializeEnhancedFeatures(): void {
    if (this.autoScaling.enabled) {
      this.startAutoScaling();
    }

    if (this.loadBalancing.healthCheck?.enabled) {
      this.startHealthChecks();
    }

    this.startSystemMonitoring();
    this.logger.info('Enhanced Request Queue initialized', {
      autoScaling: this.autoScaling.enabled,
      loadBalancing: this.loadBalancing.strategy,
      rateLimiting: !!this.options.rateLimit
    });
  }

  /**
   * Enhanced job addition with rate limiting and load balancing
   */
  async addEnhanced(
    type: EnhancedQueueJob['type'],
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      jobId?: string;
      rateLimitKey?: string;
      retryBackoff?: 'exponential' | 'linear' | 'fixed';
      maxConcurrencyOverride?: number;
    } = {}
  ): Promise<string> {
    // Check rate limiting
    if (this.options.rateLimit) {
      const key = options.rateLimitKey || this.generateRateLimitKey(type, data);
      if (!this.checkRateLimit(key)) {
        throw new Error(`Rate limit exceeded for key: ${key}`);
      }
    }

    // Create enhanced job
    const jobId = await super.add(type, data, options);
    const job = this.getJob(jobId) as EnhancedQueueJob;
    
    if (job) {
      job.rateLimitKey = options.rateLimitKey;
      job.retryBackoff = options.retryBackoff || 'exponential';
      job.maxConcurrencyOverride = options.maxConcurrencyOverride;
      job.circuitBreaker = {
        failures: 0,
        lastFailure: 0,
        state: 'closed'
      };
      job.loadBalancing = {
        attemptsPerWorker: new Map()
      };
    }

    return jobId;
  }

  /**
   * Rate limiting implementation
   */
  private checkRateLimit(key: string): boolean {
    if (!this.options.rateLimit) return true;

    const now = Date.now();
    const limit = this.rateLimitStore.get(key);

    if (!limit || now >= limit.resetTime) {
      this.rateLimitStore.set(key, {
        count: 1,
        resetTime: now + this.options.rateLimit.windowMs
      });
      return true;
    }

    if (limit.count >= this.options.rateLimit.maxRequests) {
      return false;
    }

    limit.count++;
    return true;
  }

  /**
   * Generate rate limit key based on job type and data
   */
  private generateRateLimitKey(type: string, data: any): string {
    if (this.options.rateLimit?.keyGenerator) {
      return this.options.rateGenerator({ type, data } as EnhancedQueueJob);
    }

    // Default key generation
    const userId = data.userId || 'anonymous';
    const model = data.model || 'default';
    return `${type}:${userId}:${model}`;
  }

  /**
   * Enhanced worker registration with load balancing
   */
  registerEnhancedWorker(
    type: string,
    handler: (job: EnhancedQueueJob) => Promise<any>,
    options: {
      concurrency?: number;
      weight?: number;
      healthCheck?: () => Promise<boolean>;
    } = {}
  ): string {
    const workerId = super.registerWorker(type, handler, options);
    
    // Initialize worker health tracking
    this.workerHealth.set(workerId, {
      status: 'healthy',
      lastHealthCheck: Date.now(),
      failureRate: 0,
      responseTime: 0
    });

    // Set worker weight for load balancing
    if (options.weight && this.loadBalancing.weights) {
      this.loadBalancing.weights.set(workerId, options.weight);
    }

    return workerId;
  }

  /**
   * Enhanced job processing with circuit breaker and load balancing
   */
  protected async processJob(job: EnhancedQueueJob, worker: QueueWorker): Promise<void> {
    // Check circuit breaker
    if (!this.checkCircuitBreaker(worker.id)) {
      this.logger.warn('Circuit breaker open, delaying job', { jobId: job.id, workerId: worker.id });
      setTimeout(() => this.enqueueJob(job), 5000);
      return;
    }

    // Acquire lock for thread safety
    const lockKey = this.acquireJobLock(job.id, worker.id);
    if (!lockKey) {
      this.logger.warn('Job already being processed', { jobId: job.id });
      return;
    }

    try {
      await super.processJob(job, worker);
      this.recordSuccess(worker.id);
    } catch (error) {
      this.recordFailure(worker.id, error as Error);
      this.handleCircuitBreaker(worker.id, error as Error);
      throw error;
    } finally {
      this.releaseJobLock(job.id, lockKey);
    }
  }

  /**
   * Circuit breaker implementation
   */
  private checkCircuitBreaker(workerId: string): boolean {
    const config = this.circuitBreakers.get(workerId);
    if (!config) return true;

    const now = Date.now();
    const recentFailures = config.failures.filter(time => now - time < config.monitoringPeriod);
    
    if (recentFailures.length >= config.failureThreshold) {
      const lastFailure = Math.max(...recentFailures);
      if (now - lastFailure < config.resetTimeout) {
        return false;
      }
    }

    return true;
  }

  private handleCircuitBreaker(workerId: string, error: Error): void {
    const config = this.circuitBreakers.get(workerId);
    if (!config) return;

    config.failures.push(Date.now());
    
    // Clean old failures
    const cutoff = Date.now() - config.monitoringPeriod;
    config.failures = config.failures.filter(time => time > cutoff);
  }

  private recordSuccess(workerId: string): void {
    const health = this.workerHealth.get(workerId);
    if (health) {
      health.failureRate = Math.max(0, health.failureRate * 0.9);
      health.responseTime = Date.now() - health.lastHealthCheck;
    }
  }

  private recordFailure(workerId: string, error: Error): void {
    const health = this.workerHealth.get(workerId);
    if (health) {
      health.failureRate = Math.min(1, (health.failureRate * 0.9) + 0.1);
      health.status = health.failureRate > 0.5 ? 'unhealthy' : 'degraded';
    }
  }

  /**
   * Load balancing implementation
   */
  protected findAvailableWorker(jobType: string): QueueWorker | null {
    const workers = Array.from(this.workers.values()).filter(w => w.type === jobType);
    
    if (workers.length === 0) return null;

    // Filter healthy workers
    const healthyWorkers = workers.filter(w => {
      const health = this.workerHealth.get(w.id);
      return !health || health.status === 'healthy';
    });

    if (healthyWorkers.length === 0) {
      this.logger.warn('No healthy workers available, using degraded workers');
      return workers[0];
    }

    switch (this.loadBalancing.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(healthyWorkers);
      case 'least-connections':
        return this.selectLeastConnections(healthyWorkers);
      case 'weighted':
        return this.selectWeighted(healthyWorkers);
      case 'priority':
        return this.selectPriority(healthyWorkers);
      default:
        return healthyWorkers[0];
    }
  }

  private selectRoundRobin(workers: QueueWorker[]): QueueWorker {
    const index = Date.now() % workers.length;
    return workers[index];
  }

  private selectLeastConnections(workers: QueueWorker[]): QueueWorker {
    return workers.reduce((min, worker) => 
      worker.activeJobs.size < min.activeJobs.size ? worker : min
    );
  }

  private selectWeighted(workers: QueueWorker[]): QueueWorker {
    const weights = this.loadBalancing.weights || new Map();
    const totalWeight = workers.reduce((sum, w) => sum + (weights.get(w.id) || 1), 0);
    
    let random = Math.random() * totalWeight;
    for (const worker of workers) {
      random -= weights.get(worker.id) || 1;
      if (random <= 0) return worker;
    }
    
    return workers[0];
  }

  private selectPriority(workers: QueueWorker[]): QueueWorker {
    return workers.sort((a, b) => a.activeJobs.size - b.activeJobs.size)[0];
  }

  /**
   * Auto-scaling implementation
   */
  private startAutoScaling(): void {
    this.scalingInterval = setInterval(() => {
      this.evaluateScaling();
    }, 10000); // Check every 10 seconds
  }

  private evaluateScaling(): void {
    const metrics = this.getEnhancedMetrics();
    const queuePressure = metrics.waitingJobs / this.autoScaling.scaleUpThreshold;
    
    // Scale up
    if (queuePressure > 1 && this.workers.size < this.autoScaling.maxWorkers) {
      this.scaleUp();
    }
    
    // Scale down
    if (queuePressure < 0.2 && this.workers.size > this.autoScaling.minWorkers) {
      this.scaleDown();
    }
  }

  private scaleUp(): void {
    this.logger.info('Scaling up workers', { 
      current: this.workers.size, 
      max: this.autoScaling.maxWorkers 
    });
    this.emit('scaling:up', { workers: this.workers.size });
  }

  private scaleDown(): void {
    this.logger.info('Scaling down workers', { 
      current: this.workers.size, 
      min: this.autoScaling.minWorkers 
    });
    this.emit('scaling:down', { workers: this.workers.size });
  }

  /**
   * Health checks for workers
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.loadBalancing.healthCheck?.interval || 30000);
  }

  private async performHealthChecks(): Promise<void> {
    for (const [workerId, health] of this.workerHealth.entries()) {
      try {
        // Simulate health check
        const startTime = Date.now();
        const isHealthy = await this.checkWorkerHealth(workerId);
        const responseTime = Date.now() - startTime;

        health.status = isHealthy ? 'healthy' : 'unhealthy';
        health.lastHealthCheck = Date.now();
        health.responseTime = responseTime;
      } catch (error) {
        health.status = 'unhealthy';
        health.lastHealthCheck = Date.now();
      }
    }
  }

  private async checkWorkerHealth(workerId: string): Promise<boolean> {
    // Placeholder for actual health check
    return Math.random() > 0.1; // 90% healthy
  }

  /**
   * System monitoring
   */
  private startSystemMonitoring(): void {
    setInterval(() => {
      this.updateSystemMetrics();
    }, 5000);
  }

  private updateSystemMetrics(): void {
    // Simulate system metrics
    this.systemMetrics = {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      queuePressure: this.getQueueStatus().waiting / 100
    };
  }

  /**
   * Thread safety with job locks
   */
  private acquireJobLock(jobId: string, workerId: string): string | null {
    const lockKey = `lock:${jobId}`;
    if (this.jobLocks.has(lockKey)) {
      return null;
    }
    
    const lockId = `${workerId}:${Date.now()}`;
    this.jobLocks.set(lockKey, lockId);
    return lockId;
  }

  private releaseJobLock(jobId: string, lockId: string): void {
    const lockKey = `lock:${jobId}`;
    const currentLock = this.jobLocks.get(lockKey);
    
    if (currentLock === lockId) {
      this.jobLocks.delete(lockKey);
    }
  }

  /**
   * Enhanced metrics collection
   */
  getEnhancedMetrics(): EnhancedQueueMetrics {
    const baseMetrics = this.getMetrics();
    
    return {
      ...baseMetrics,
      rateLimitHits: this.rateLimitStore.size,
      circuitBreakerTrips: Array.from(this.circuitBreakers.values())
        .reduce((sum, cb) => sum + cb.failures.length, 0),
      autoScalingEvents: 0, // Track scaling events
      loadBalancingDecisions: 0, // Track load balancing
      workerHealth: new Map(this.workerHealth),
      systemLoad: { ...this.systemMetrics }
    };
  }

  /**
   * Enhanced shutdown with graceful scaling
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down enhanced queue...');

    // Stop auto-scaling
    if (this.scalingInterval) {
      clearInterval(this.scalingInterval);
    }

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Wait for graceful worker shutdown
    await this.gracefulWorkerShutdown();

    // Call parent shutdown
    await super.shutdown();
  }

  private async gracefulWorkerShutdown(): Promise<void> {
    const activeWorkers = Array.from(this.workers.keys());
    
    for (const workerId of activeWorkers) {
      const health = this.workerHealth.get(workerId);
      if (health && health.status === 'healthy') {
        // Mark for graceful shutdown
        health.status = 'degraded';
      }
    }

    // Wait for active jobs to complete
    const maxWait = 30000;
    const startTime = Date.now();
    
    while (this.getQueueStatus().active > 0 && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Utility methods
   */
  getJob(jobId: string): EnhancedQueueJob | undefined {
    return super.jobs.get(jobId) as EnhancedQueueJob;
  }

  getWorkerHealth(workerId: string): EnhancedQueueMetrics['workerHealth'][string] | undefined {
    return this.workerHealth.get(workerId);
  }

  resetRateLimit(key: string): void {
    this.rateLimitStore.delete(key);
  }

  resetCircuitBreaker(workerId: string): void {
    this.circuitBreakers.delete(workerId);
  }
}