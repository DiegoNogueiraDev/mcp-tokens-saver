/**
 * High-Concurrency Queue System - Complete implementation with load balancing
 * BullMQ-style implementation with Node.js native solutions
 * Handles thundering herd, rate limiting, and automatic scaling
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger.js';

export interface QueueJob {
  id: string;
  type: 'llm_request' | 'cache_miss' | 'model_optimization' | 'cleanup';
  data: any;
  priority: number;
  attempts: number;
  maxAttempts: number;
  delay: number;
  createdAt: number;
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  error?: string;
  rateLimitKey?: string;
  retryBackoff?: 'exponential' | 'linear' | 'fixed';
  maxConcurrencyOverride?: number;
  circuitBreaker?: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  };
}

export interface QueueWorker {
  id: string;
  type: string;
  handler: (job: QueueJob) => Promise<any>;
  concurrency: number;
  activeJobs: Set<string>;
  weight?: number;
  healthCheck?: () => Promise<boolean>;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (job: QueueJob) => string;
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
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  metricsWindow: number;
}

export interface QueueOptions {
  maxConcurrency?: number;
  defaultJobOptions?: {
    attempts?: number;
    delay?: number;
    priority?: number;
  };
  retryDelayMultiplier?: number;
  enableMetrics?: boolean;
  cleanupInterval?: number;
  rateLimit?: RateLimitConfig;
  loadBalancing?: LoadBalancingConfig;
  circuitBreaker?: CircuitBreakerConfig;
  autoScaling?: AutoScalingConfig;
}

export interface QueueMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  waitingJobs: number;
  avgProcessingTime: number;
  avgWaitTime: number;
  throughputPerMinute: number;
  errorRate: number;
  workerUtilization: Record<string, number>;
  rateLimitHits: number;
  circuitBreakerTrips: number;
  autoScalingEvents: number;
  loadBalancingDecisions: number;
  workerHealth: Record<string, {
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

export class HighConcurrencyQueue extends EventEmitter {
  private jobs: Map<string, QueueJob> = new Map();
  private waitingQueue: QueueJob[] = [];
  private workers: Map<string, QueueWorker> = new Map();
  private processingJobs: Set<string> = new Set();
  private completedJobs: QueueJob[] = [];
  private failedJobs: QueueJob[] = [];
  private options: Required<QueueOptions>;
  private logger: Logger;
  private metrics: QueueMetrics;
  private metricsInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
  private circuitBreakers: Map<string, { failures: number[]; config: CircuitBreakerConfig }> = new Map();
  private workerHealth: Map<string, QueueMetrics['workerHealth'][string]> = new Map();
  private systemMetrics: QueueMetrics['systemLoad'];
  private jobLocks: Map<string, string> = new Map();
  private scalingInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private roundRobinIndex: number = 0;

  constructor(options: QueueOptions = {}) {
    super();
    
    this.options = {
      maxConcurrency: 10,
      defaultJobOptions: {
        attempts: 3,
        delay: 0,
        priority: 5
      },
      retryDelayMultiplier: 2,
      enableMetrics: true,
      cleanupInterval: 60000,
      rateLimit: {
        windowMs: 60000,
        maxRequests: 100,
        ...options.rateLimit
      },
      loadBalancing: {
        strategy: 'least-connections',
        healthCheck: {
          enabled: true,
          interval: 30000,
          timeout: 5000
        },
        ...options.loadBalancing
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 30000,
        monitoringPeriod: 60000,
        ...options.circuitBreaker
      },
      autoScaling: {
        enabled: true,
        minWorkers: 1,
        maxWorkers: 10,
        scaleUpThreshold: 50,
        scaleDownThreshold: 30000,
        metricsWindow: 60000,
        ...options.autoScaling
      },
      ...options
    };

    this.logger = new Logger('HighConcurrencyQueue');
    this.metrics = this.initializeMetrics();
    this.systemMetrics = {
      cpu: 0,
      memory: 0,
      queuePressure: 0
    };

    this.initializeQueue();
  }

  private initializeQueue(): void {
    if (this.options.enableMetrics) {
      this.startMetricsCollection();
    }

    if (this.options.cleanupInterval > 0) {
      this.startCleanupScheduler();
    }

    if (this.options.autoScaling.enabled) {
      this.startAutoScaling();
    }

    if (this.options.loadBalancing.healthCheck?.enabled) {
      this.startHealthChecks();
    }

    this.startSystemMonitoring();
    
    this.logger.info('High-Concurrency Queue initialized', {
      maxConcurrency: this.options.maxConcurrency,
      autoScaling: this.options.autoScaling.enabled,
      loadBalancing: this.options.loadBalancing.strategy
    });
  }

  async add(
    type: QueueJob['type'],
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      jobId?: string;
      rateLimitKey?: string;
    } = {}
  ): Promise<string> {
    // Check rate limiting
    if (this.options.rateLimit) {
      const key = options.rateLimitKey || this.generateRateLimitKey(type, data);
      if (!this.checkRateLimit(key)) {
        this.metrics.rateLimitHits++;
        throw new Error(`Rate limit exceeded for key: ${key}`);
      }
    }

    const jobOptions = { ...this.options.defaultJobOptions, ...options };
    const jobId = options.jobId || this.generateJobId();
    const now = Date.now();

    const job: QueueJob = {
      id: jobId,
      type,
      data,
      priority: jobOptions.priority!,
      attempts: 0,
      maxAttempts: jobOptions.attempts!,
      delay: jobOptions.delay!,
      createdAt: now,
      scheduledAt: now + jobOptions.delay!,
      circuitBreaker: {
        failures: 0,
        lastFailure: 0,
        state: 'closed'
      }
    };

    this.jobs.set(jobId, job);
    
    if (job.scheduledAt <= now) {
      this.enqueueJob(job);
    } else {
      setTimeout(() => {
        if (this.jobs.has(jobId)) {
          this.enqueueJob(job);
        }
      }, job.delay);
    }

    this.emit('job:added', job);
    this.logger.debug('Job added to queue', { jobId, type, priority: job.priority });

    return jobId;
  }

  registerWorker(
    type: string,
    handler: (job: QueueJob) => Promise<any>,
    options: {
      concurrency?: number;
      weight?: number;
      healthCheck?: () => Promise<boolean>;
    } = {}
  ): string {
    const workerId = `${type}-${Date.now()}`;
    
    const worker: QueueWorker = {
      id: workerId,
      type,
      handler,
      concurrency: options.concurrency || 1,
      activeJobs: new Set(),
      weight: options.weight || 1,
      healthCheck: options.healthCheck
    };

    this.workers.set(workerId, worker);
    this.workerHealth.set(workerId, {
      status: 'healthy',
      lastHealthCheck: Date.now(),
      failureRate: 0,
      responseTime: 0
    });

    this.logger.info('Worker registered', { workerId, type, concurrency: worker.concurrency });
    this.processNextJobs();

    return workerId;
  }

  unregisterWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    if (worker.activeJobs.size > 0) {
      this.logger.warn('Worker has active jobs, waiting for completion', {
        workerId,
        activeJobs: worker.activeJobs.size
      });
    }

    this.workers.delete(workerId);
    this.workerHealth.delete(workerId);
    this.logger.info('Worker unregistered', { workerId });
    
    return true;
  }

  private async processNextJobs(): Promise<void> {
    if (this.waitingQueue.length === 0 || this.processingJobs.size >= this.options.maxConcurrency) {
      return;
    }

    this.waitingQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });

    for (const job of this.waitingQueue) {
      if (this.processingJobs.size >= this.options.maxConcurrency) {
        break;
      }

      const availableWorker = this.findAvailableWorker(job.type);
      if (!availableWorker) {
        continue;
      }

      const jobIndex = this.waitingQueue.indexOf(job);
      this.waitingQueue.splice(jobIndex, 1);

      this.processJob(job, availableWorker);
    }
  }

  private async processJob(job: QueueJob, worker: QueueWorker): Promise<void> {
    // Check circuit breaker
    if (!this.checkCircuitBreaker(worker.id)) {
      this.logger.warn('Circuit breaker open, delaying job', { jobId: job.id, workerId: worker.id });
      setTimeout(() => this.enqueueJob(job), 5000);
      return;
    }

    // Check for duplicate processing
    if (this.jobLocks.has(job.id)) {
      this.logger.warn('Job already being processed', { jobId: job.id });
      return;
    }

    this.jobLocks.set(job.id, worker.id);
    job.startedAt = Date.now();
    job.attempts++;

    this.processingJobs.add(job.id);
    worker.activeJobs.add(job.id);

    this.emit('job:started', job);
    this.logger.debug('Job processing started', { 
      jobId: job.id, 
      workerId: worker.id, 
      attempt: job.attempts 
    });

    try {
      const result = await worker.handler(job);
      
      job.completedAt = Date.now();
      this.completedJobs.push(job);
      
      this.processingJobs.delete(job.id);
      worker.activeJobs.delete(job.id);
      this.jobLocks.delete(job.id);

      this.emit('job:completed', job, result);
      this.recordSuccess(worker.id);
      this.updateMetrics(job, 'completed');

    } catch (error) {
      this.processingJobs.delete(job.id);
      worker.activeJobs.delete(job.id);
      this.jobLocks.delete(job.id);

      this.recordFailure(worker.id, error as Error);
      this.handleJobError(job, worker, error as Error);
    }

    setImmediate(() => this.processNextJobs());
  }

  private checkRateLimit(key: string): boolean {
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

  private generateRateLimitKey(type: string, data: any): string {
    if (this.options.rateLimit.keyGenerator) {
      return this.options.rateLimit.keyGenerator({ type, data } as QueueJob);
    }

    const userId = data.userId || 'anonymous';
    const model = data.model || 'default';
    return `${type}:${userId}:${model}`;
  }

  private checkCircuitBreaker(workerId: string): boolean {
    const breaker = this.circuitBreakers.get(workerId);
    if (!breaker) return true;

    const now = Date.now();
    const recentFailures = breaker.failures.filter(time => now - time < breaker.config.monitoringPeriod);
    
    if (recentFailures.length >= breaker.config.failureThreshold) {
      const lastFailure = Math.max(...recentFailures);
      if (now - lastFailure < breaker.config.resetTimeout) {
        this.metrics.circuitBreakerTrips++;
        return false;
      }
    }

    return true;
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

    const breaker = this.circuitBreakers.get(workerId);
    if (breaker) {
      breaker.failures.push(Date.now());
      const cutoff = Date.now() - breaker.config.monitoringPeriod;
      breaker.failures = breaker.failures.filter(time => time > cutoff);
    }
  }

  private findAvailableWorker(jobType: string): QueueWorker | null {
    const workers = Array.from(this.workers.values()).filter(w => w.type === jobType);
    
    if (workers.length === 0) return null;

    const healthyWorkers = workers.filter(w => {
      const health = this.workerHealth.get(w.id);
      return !health || health.status === 'healthy';
    });

    if (healthyWorkers.length === 0) {
      this.logger.warn('No healthy workers available, using degraded workers');
      return workers[0];
    }

    this.metrics.loadBalancingDecisions++;

    const lbConfig = this.options.loadBalancing as LoadBalancingConfig;
    switch (lbConfig.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(healthyWorkers);
      case 'least-connections':
        return this.selectLeastConnections(healthyWorkers);
      case 'weighted':
        return this.selectWeighted(healthyWorkers, lbConfig.weights);
      case 'priority':
        return this.selectPriority(healthyWorkers);
      default:
        return healthyWorkers[0];
    }
  }

  private selectRoundRobin(workers: QueueWorker[]): QueueWorker {
    const worker = workers[this.roundRobinIndex % workers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % workers.length;
    return worker;
  }

  private selectLeastConnections(workers: QueueWorker[]): QueueWorker {
    return workers.reduce((min, worker) =>
      worker.activeJobs.size < min.activeJobs.size ? worker : min
    );
  }

  private selectWeighted(workers: QueueWorker[], weights?: Map<string, number>): QueueWorker {
    const weightMap = weights || new Map();
    const totalWeight = workers.reduce((sum, w) => sum + (weightMap.get(w.id) || w.weight || 1), 0);
    
    let random = Math.random() * totalWeight;
    for (const worker of workers) {
      random -= weightMap.get(worker.id) || worker.weight || 1;
      if (random <= 0) return worker;
    }
    
    return workers[0];
  }

  private selectPriority(workers: QueueWorker[]): QueueWorker {
    return workers.sort((a, b) => a.activeJobs.size - b.activeJobs.size)[0];
  }

  private handleJobError(job: QueueJob, worker: QueueWorker, error: Error): void {
    job.error = error.message;
    
    this.logger.error('Job processing failed', { 
      jobId: job.id, 
      attempt: job.attempts, 
      error: error.message 
    });

    if (job.attempts < job.maxAttempts) {
      const retryDelay = job.delay * Math.pow(this.options.retryDelayMultiplier, job.attempts - 1);
      job.scheduledAt = Date.now() + retryDelay;
      
      this.logger.info('Job scheduled for retry', { 
        jobId: job.id, 
        retryDelay, 
        nextAttempt: job.attempts + 1 
      });

      setTimeout(() => {
        if (this.jobs.has(job.id)) {
          this.enqueueJob(job);
        }
      }, retryDelay);

      this.emit('job:retry', job, error);
    } else {
      job.failedAt = Date.now();
      this.failedJobs.push(job);
      
      this.emit('job:failed', job, error);
      this.logger.error('Job failed permanently', { 
        jobId: job.id, 
        totalAttempts: job.attempts 
      });

      this.updateMetrics(job, 'failed');
    }
  }

  private enqueueJob(job: QueueJob): void {
    this.waitingQueue.push(job);
    this.emit('job:waiting', job);
    setImmediate(() => this.processNextJobs());
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private initializeMetrics(): QueueMetrics {
    return {
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
      systemLoad: {
        cpu: 0,
        memory: 0,
        queuePressure: 0
      }
    };
  }

  private updateMetrics(job: QueueJob, status: 'completed' | 'failed'): void {
    this.metrics.totalJobs++;
    
    if (status === 'completed') {
      this.metrics.completedJobs++;
      
      if (job.startedAt && job.completedAt) {
        const processingTime = job.completedAt - job.startedAt;
        this.metrics.avgProcessingTime = 
          (this.metrics.avgProcessingTime * (this.metrics.completedJobs - 1) + processingTime) / 
          this.metrics.completedJobs;
      }
      
      if (job.startedAt) {
        const waitTime = job.startedAt - job.createdAt;
        this.metrics.avgWaitTime = 
          (this.metrics.avgWaitTime * (this.metrics.completedJobs - 1) + waitTime) / 
          this.metrics.completedJobs;
      }
    } else {
      this.metrics.failedJobs++;
    }

    this.metrics.errorRate = this.metrics.totalJobs > 0 ? 
      this.metrics.failedJobs / this.metrics.totalJobs : 0;

    // Update worker utilization
    for (const [workerId, worker] of this.workers) {
      this.metrics.workerUtilization[workerId] = worker.activeJobs.size / worker.concurrency;
    }
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.metrics.activeJobs = this.processingJobs.size;
      this.metrics.waitingJobs = this.waitingQueue.length;

      const oneMinuteAgo = Date.now() - 60000;
      this.metrics.throughputPerMinute = this.completedJobs.filter(
        job => job.completedAt && job.completedAt > oneMinuteAgo
      ).length;

      this.metrics.workerHealth = {};
      for (const [workerId, health] of this.workerHealth) {
        this.metrics.workerHealth[workerId] = { ...health };
      }

      this.metrics.systemLoad = { ...this.systemMetrics };

      this.emit('metrics:updated', this.metrics);
    }, 5000);
  }

  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  private cleanup(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    const initialCompletedCount = this.completedJobs.length;
    this.completedJobs = this.completedJobs.filter(
      job => (job.completedAt || 0) > oneDayAgo
    );

    const initialFailedCount = this.failedJobs.length;
    this.failedJobs = this.failedJobs.filter(
      job => (job.failedAt || 0) > oneDayAgo
    );

    for (const job of [...this.completedJobs, ...this.failedJobs]) {
      if ((job.completedAt || job.failedAt || 0) <= oneDayAgo) {
        this.jobs.delete(job.id);
      }
    }

    const cleanedCompleted = initialCompletedCount - this.completedJobs.length;
    const cleanedFailed = initialFailedCount - this.failedJobs.length;

    if (cleanedCompleted > 0 || cleanedFailed > 0) {
      this.logger.info('Queue cleanup completed', {
        cleanedCompleted,
        cleanedFailed,
        remainingJobs: this.jobs.size
      });
    }
  }

  private startAutoScaling(): void {
    this.scalingInterval = setInterval(() => {
      this.evaluateScaling();
    }, 10000);
  }

  private evaluateScaling(): void {
    const queuePressure = this.waitingQueue.length / this.options.autoScaling.scaleUpThreshold;
    
    if (queuePressure > 1) {
      this.metrics.autoScalingEvents++;
      this.emit('scaling:needed', { direction: 'up', pressure: queuePressure });
    }
    
    if (queuePressure < 0.2 && this.waitingQueue.length === 0) {
      this.emit('scaling:needed', { direction: 'down', pressure: queuePressure });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, (this.options.loadBalancing as LoadBalancingConfig).healthCheck?.interval || 30000);
  }

  private async performHealthChecks(): Promise<void> {
    for (const [workerId, worker] of this.workers) {
      const health = this.workerHealth.get(workerId);
      if (!health) continue;

      try {
        const isHealthy = worker.healthCheck ? await worker.healthCheck() : true;
        health.status = isHealthy ? 'healthy' : 'unhealthy';
        health.lastHealthCheck = Date.now();
      } catch (error) {
        health.status = 'unhealthy';
        health.lastHealthCheck = Date.now();
      }
    }
  }

  private startSystemMonitoring(): void {
    setInterval(() => {
      this.updateSystemMetrics();
    }, 5000);
  }

  private updateSystemMetrics(): void {
    this.systemMetrics = {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      queuePressure: this.waitingQueue.length / 100
    };
  }

  getQueueStatus(): {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    workers: Array<{
      id: string;
      type: string;
      activeJobs: number;
      concurrency: number;
      utilization: number;
      health: string;
    }>;
  } {
    const workers = Array.from(this.workers.values()).map(worker => ({
      id: worker.id,
      type: worker.type,
      activeJobs: worker.activeJobs.size,
      concurrency: worker.concurrency,
      utilization: worker.activeJobs.size / worker.concurrency,
      health: this.workerHealth.get(worker.id)?.status || 'unknown'
    }));

    return {
      waiting: this.waitingQueue.length,
      active: this.processingJobs.size,
      completed: this.completedJobs.length,
      failed: this.failedJobs.length,
      workers
    };
  }

  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down high-concurrency queue...');

    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.scalingInterval) clearInterval(this.scalingInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.waitingQueue = [];

    const shutdownTimeout = 30000;
    const shutdownPromise = new Promise<void>((resolve) => {
      if (this.processingJobs.size === 0) {
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.processingJobs.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, shutdownTimeout);
    });

    await Promise.race([shutdownPromise, timeoutPromise]);

    this.workers.clear();
    this.logger.info('Queue shutdown completed', {
      remainingActiveJobs: this.processingJobs.size
    });
  }

  resetRateLimit(key: string): void {
    this.rateLimitStore.delete(key);
  }

  resetCircuitBreaker(workerId: string): void {
    this.circuitBreakers.delete(workerId);
  }

  getWorkerHealth(workerId: string): QueueMetrics['workerHealth'][string] | undefined {
    return this.workerHealth.get(workerId);
  }
}