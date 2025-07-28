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
