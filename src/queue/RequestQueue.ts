/**
 * Request Queue System - Evita thundering herd quando múltiplos pedidos falham no cache
 * Sistema leve inspirado no BullMQ para lidar com concorrência e picos de carga
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger.js';

export interface QueueJob {
  id: string;
  type: 'llm_request' | 'cache_miss' | 'model_optimization' | 'cleanup';
  data: any;
  priority: number; // 1-10, onde 10 é mais prioritário
  attempts: number;
  maxAttempts: number;
  delay: number; // ms
  createdAt: number;
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  error?: string;
}

export interface QueueWorker {
  id: string;
  type: string;
  handler: (job: QueueJob) => Promise<any>;
  concurrency: number;
  activeJobs: Set<string>;
}

export interface QueueOptions {
  maxConcurrency?: number;
  defaultJobOptions?: {
    attempts?: number;
    delay?: number;
    priority?: number;
  };
  retryDelayMultiplier?: number; // 2x delay a cada retry
  enableMetrics?: boolean;
  cleanupInterval?: number; // ms
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
}

export class RequestQueue extends EventEmitter {
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

  constructor(options: QueueOptions = {}) {
    super();
    
    this.options = {
      maxConcurrency: 5,
      defaultJobOptions: {
        attempts: 3,
        delay: 0,
        priority: 5
      },
      retryDelayMultiplier: 2,
      enableMetrics: true,
      cleanupInterval: 60000, // 1 minute
      ...options
    };

    this.logger = new Logger('RequestQueue');
    this.metrics = this.initializeMetrics();

    if (this.options.enableMetrics) {
      this.startMetricsCollection();
    }

    if (this.options.cleanupInterval > 0) {
      this.startCleanupScheduler();
    }

    this.logger.info('Request Queue initialized', {
      maxConcurrency: this.options.maxConcurrency,
      metricsEnabled: this.options.enableMetrics
    });
  }

  /**
   * Adiciona job à fila
   */
  async add(
    type: QueueJob['type'],
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      jobId?: string;
    } = {}
  ): Promise<string> {
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
      scheduledAt: now + jobOptions.delay!
    };

    this.jobs.set(jobId, job);
    
    if (job.scheduledAt <= now) {
      this.enqueueJob(job);
    } else {
      // Schedule for later
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

  /**
   * Registra worker para processar jobs
   */
  registerWorker(
    type: string,
    handler: (job: QueueJob) => Promise<any>,
    options: { concurrency?: number } = {}
  ): string {
    const workerId = `${type}-${Date.now()}`;
    
    const worker: QueueWorker = {
      id: workerId,
      type,
      handler,
      concurrency: options.concurrency || 1,
      activeJobs: new Set()
    };

    this.workers.set(workerId, worker);
    this.logger.info('Worker registered', { workerId, type, concurrency: worker.concurrency });

    // Start processing immediately if there are jobs waiting
    this.processNextJobs();

    return workerId;
  }

  /**
   * Remove worker
   */
  unregisterWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    // Wait for active jobs to complete
    if (worker.activeJobs.size > 0) {
      this.logger.warn('Worker has active jobs, waiting for completion', {
        workerId,
        activeJobs: worker.activeJobs.size
      });
      
      // Could implement graceful shutdown here
    }

    this.workers.delete(workerId);
    this.logger.info('Worker unregistered', { workerId });
    
    return true;
  }

  /**
   * Processa próximos jobs disponíveis
   */
  private async processNextJobs(): Promise<void> {
    if (this.waitingQueue.length === 0 || this.processingJobs.size >= this.options.maxConcurrency) {
      return;
    }

    // Ordena por prioridade (maior primeiro) e depois por data de criação
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
        continue; // No available worker for this job type
      }

      // Remove job from waiting queue
      const jobIndex = this.waitingQueue.indexOf(job);
      this.waitingQueue.splice(jobIndex, 1);

      // Process job
      this.processJob(job, availableWorker);
    }
  }

  /**
   * Processa um job específico
   */
  private async processJob(job: QueueJob, worker: QueueWorker): Promise<void> {
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

      this.emit('job:completed', job, result);
      this.logger.debug('Job completed successfully', { 
        jobId: job.id, 
        duration: job.completedAt - job.startedAt! 
      });

      this.updateMetrics(job, 'completed');

    } catch (error) {
      this.handleJobError(job, worker, error as Error);
    }

    // Process next jobs
    setImmediate(() => this.processNextJobs());
  }

  /**
   * Lida com erros em jobs
   */
  private async handleJobError(job: QueueJob, worker: QueueWorker, error: Error): Promise<void> {
    job.error = error.message;
    
    this.processingJobs.delete(job.id);
    worker.activeJobs.delete(job.id);

    this.logger.error('Job processing failed', { 
      jobId: job.id, 
      attempt: job.attempts, 
      error: error.message 
    });

    if (job.attempts < job.maxAttempts) {
      // Retry with exponential backoff
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
      // Max attempts reached
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

  /**
   * Adiciona job à fila de espera
   */
  private enqueueJob(job: QueueJob): void {
    this.waitingQueue.push(job);
    this.emit('job:waiting', job);
    
    // Process immediately if possible
    setImmediate(() => this.processNextJobs());
  }

  /**
   * Encontra worker disponível para o tipo de job
   */
  private findAvailableWorker(jobType: string): QueueWorker | null {
    for (const worker of this.workers.values()) {
      if (worker.type === jobType && worker.activeJobs.size < worker.concurrency) {
        return worker;
      }
    }
    return null;
  }

  /**
   * Gera ID único para job
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Obtém status da fila
   */
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
    }>;
  } {
    const workers = Array.from(this.workers.values()).map(worker => ({
      id: worker.id,
      type: worker.type,
      activeJobs: worker.activeJobs.size,
      concurrency: worker.concurrency,
      utilization: worker.activeJobs.size / worker.concurrency
    }));

    return {
      waiting: this.waitingQueue.length,
      active: this.processingJobs.size,
      completed: this.completedJobs.length,
      failed: this.failedJobs.length,
      workers
    };
  }

  /**
   * Obtém métricas detalhadas
   */
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  /**
   * Inicializa métricas
   */
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
      workerUtilization: {}
    };
  }

  /**
   * Atualiza métricas
   */
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
  }

  /**
   * Coleta métricas periodicamente
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.metrics.activeJobs = this.processingJobs.size;
      this.metrics.waitingJobs = this.waitingQueue.length;

      // Calculate throughput (jobs completed in last minute)
      const oneMinuteAgo = Date.now() - 60000;
      this.metrics.throughputPerMinute = this.completedJobs.filter(
        job => job.completedAt && job.completedAt > oneMinuteAgo
      ).length;

      // Worker utilization
      this.metrics.workerUtilization = {};
      for (const worker of this.workers.values()) {
        this.metrics.workerUtilization[worker.type] = 
          worker.activeJobs.size / worker.concurrency;
      }

      this.emit('metrics:updated', this.metrics);
    }, 5000); // Update every 5 seconds
  }

  /**
   * Limpeza periódica de jobs antigos
   */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Remove jobs antigos completados/falhados
   */
  private cleanup(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    // Clean completed jobs older than 1 day
    const initialCompletedCount = this.completedJobs.length;
    this.completedJobs = this.completedJobs.filter(
      job => (job.completedAt || 0) > oneDayAgo
    );

    // Clean failed jobs older than 1 day
    const initialFailedCount = this.failedJobs.length;
    this.failedJobs = this.failedJobs.filter(
      job => (job.failedAt || 0) > oneDayAgo
    );

    // Remove job references
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

  /**
   * Para a fila e limpa recursos
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down queue...');

    // Stop accepting new jobs
    this.waitingQueue = [];

    // Wait for active jobs to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
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

    // Clear intervals
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear workers
    this.workers.clear();

    this.logger.info('Queue shutdown completed', {
      remainingActiveJobs: this.processingJobs.size
    });
  }
}