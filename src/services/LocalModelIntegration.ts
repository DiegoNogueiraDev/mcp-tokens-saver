import { LocalModelManager } from '../providers/LocalModelManager.js';
import { LocalModelRouter } from './LocalModelRouter.js';
import { ModelOptimizer } from './ModelOptimizer.js';
import { Logger } from '../utils/Logger.js';

export interface LocalModelConfig {
  enabled: boolean;
  autoDetect: boolean;
  preferredModels: string[];
  costThreshold: number;
  contextThreshold: number;
}

export interface ModelHealthStatus {
  model: string;
  status: 'healthy' | 'unhealthy' | 'unknown' | 'not_downloaded';
  memoryUsage?: number;
  responseTime?: number;
  lastCheck?: Date;
}

export class LocalModelIntegration {
  private logger: Logger;
  private localManager: LocalModelManager;
  private localRouter: LocalModelRouter;
  private modelOptimizer: ModelOptimizer;
  private config: LocalModelConfig;

  constructor(config: LocalModelConfig = {
    enabled: true,
    autoDetect: true,
    preferredModels: ['phi-3-mini-4k-instruct', 'gemma-2-2b-it'],
    costThreshold: 0.002,
    contextThreshold: 1024
  }) {
    this.logger = new Logger('LocalModelIntegration');
    this.localManager = new LocalModelManager();
    this.localRouter = new LocalModelRouter();
    this.modelOptimizer = new ModelOptimizer();
    this.config = config;
  }

  /**
   * Initialize local model integration
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing local model integration', this.config);
    
    if (!this.config.enabled) {
      this.logger.info('Local models disabled in configuration');
      return;
    }

    try {
      // Auto-detect available local models
      if (this.config.autoDetect) {
        await this.autoDetectModels();
      }

      // Update ModelOptimizer with local model status
      await this.updateOptimizerWithLocalStatus();
      
      this.logger.info('Local model integration initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize local model integration', error);
    }
  }

  /**
   * Auto-detect and setup local models
   */
  private async autoDetectModels(): Promise<void> {
    const available = await this.localManager.autoDetectModels();
    
    if (available.length === 0) {
      this.logger.info('No local models detected');
      return;
    }

    this.logger.info('Detected local models', { models: available });
    
    // Check health of detected models
    const healthStatuses = await this.localManager.getModelStatuses();
    for (const status of healthStatuses) {
      if (status.isDownloaded && !status.isRunning) {
        this.logger.info(`Starting model: ${status.name}`);
        await this.localManager.startModel(status.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
      }
    }
  }

  /**
   * Update ModelOptimizer with local model availability
   */
  private async updateOptimizerWithLocalStatus(): Promise<void> {
    const health = await this.localRouter.checkLocalModelsHealth();
    const hasLocalModels = Object.keys(health).length > 0;
    
    this.modelOptimizer.updateRoutingInfo(
      undefined, // cacheHitRate
      undefined, // cacheLatency
      hasLocalModels, // localModelAvailable
      hasLocalModels ? 1000 : 2000 // localModelLatency
    );
  }

  /**
   * Get health status of all local models
   */
  async getHealthStatus(): Promise<ModelHealthStatus[]> {
    const statuses = await this.localManager.getModelStatuses();
    
    return statuses.map(status => ({
      model: status.name,
      status: this.mapStatus(status),
      memoryUsage: status.memoryUsage,
      responseTime: status.responseTime,
      lastCheck: status.lastHealthCheck ? new Date(status.lastHealthCheck) : undefined
    }));
  }

  /**
   * Map LocalModelManager status to ModelHealthStatus
   */
  private mapStatus(status: any): ModelHealthStatus['status'] {
    if (!status.isDownloaded) return 'not_downloaded';
    if (!status.isRunning) return 'unhealthy';
    return status.health;
  }

  /**
   * Make routing decision with local model consideration
   */
  async routeWithLocalModels(
    taskType: string,
    contextTokens: number = 0,
    options: Partial<LocalModelConfig> = {}
  ): Promise<{
    selectedModel: string;
    selectedProvider: string;
    reason: string;
    estimatedCost: number;
    localModelUsed: boolean;
    healthStatus: ModelHealthStatus[];
  }> {
    const mergedConfig = { ...this.config, ...options };
    
    const routingDecision = await this.localRouter.routeRequest(taskType, {
      maxCostThreshold: mergedConfig.costThreshold,
      contextTokens,
      preferLocal: mergedConfig.enabled,
      forceLocal: false,
      forceRemote: false
    });

    const healthStatus = await this.getHealthStatus();
    
    return {
      selectedModel: routingDecision.selectedModel,
      selectedProvider: routingDecision.selectedProvider,
      reason: routingDecision.reason,
      estimatedCost: routingDecision.estimatedCost,
      localModelUsed: routingDecision.localModelUsed,
      healthStatus
    };
  }

  /**
   * Download and setup local models
   */
  async setupModels(models: string[] = []): Promise<void> {
    const modelsToSetup = models.length > 0 ? models : this.config.preferredModels;
    
    this.logger.info('Setting up local models', { models: modelsToSetup });
    
    for (const model of modelsToSetup) {
      try {
        await this.localManager.downloadModel(model);
        await this.localManager.startModel(model);
        this.logger.info(`Model ${model} setup completed`);
      } catch (error) {
        this.logger.error(`Failed to setup model ${model}`, error);
      }
    }
    
    // Update status after setup
    await this.updateOptimizerWithLocalStatus();
  }

  /**
   * Get cost analysis with local model options
   */
  async getCostAnalysis(
    dailyRequests: number,
    averagePromptLength: number,
    taskType: string = 'general'
  ): Promise<{
    remoteCost: number;
    localCost: number;
    savings: number;
    localAvailable: boolean;
    recommendedStrategy: string;
  }> {
    const projections = await this.modelOptimizer.getMonthlyProjections(
      dailyRequests,
      averagePromptLength,
      { [taskType]: 1.0 }
    );

    const localHealth = await this.localRouter.checkLocalModelsHealth();
    const localAvailable = Object.keys(localHealth).length > 0;

    return {
      remoteCost: projections.optimized.monthlyCost,
      localCost: projections.withLocal.monthlyCost,
      savings: projections.totalSavings.amount,
      localAvailable,
      recommendedStrategy: projections.totalSavings.breakdown.localFallback > 0 
        ? 'Use local models for maximum savings'
        : 'Use optimized remote models with caching'
    };
  }

  /**
   * Dynamic model switching based on load and cost
   */
  async switchModel(
    newModel: string,
    reason: string = 'User request'
  ): Promise<boolean> {
    this.logger.info('Switching model', { newModel, reason });
    
    try {
      if (newModel.startsWith('local-')) {
        const modelName = newModel.replace('local-', '');
        const isRunning = await this.localManager.startModel(modelName);
        
        if (isRunning) {
          await this.updateOptimizerWithLocalStatus();
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to switch model', error);
      return false;
    }
  }

  /**
   * Get recommendations for optimal setup
   */
  async getRecommendations(): Promise<{
    localAvailable: string[];
    remoteAvailable: string[];
    recommendedStrategy: string;
    estimatedSavings: number;
    systemRAM: number;
    setupRequired: boolean;
  }> {
    const recommendations = await this.localRouter.getRecommendations();
    const systemRAM = await this.localRouter.getSystemRAM();
    
    return {
      ...recommendations,
      systemRAM,
      setupRequired: recommendations.localAvailable.length === 0
    };
  }

  /**
   * Monitor and maintain local models
   */
  async monitorModels(): Promise<void> {
    if (!this.config.enabled) return;

    const health = await this.getHealthStatus();
    
    for (const status of health) {
      if (status.status === 'unhealthy') {
        this.logger.warn('Unhealthy model detected', { model: status.model });
        // Attempt restart
        const modelId = status.model.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        await this.localManager.stopModel(modelId);
        await this.localManager.startModel(modelId);
      }
    }
  }

  /**
   * Get configuration for API calls
   */
  getProviderConfig(model: string): {
    baseURL: string;
    headers: Record<string, string>;
    modelName: string;
  } | null {
    if (model === 'phi-3-mini-4k-instruct') {
      return {
        baseURL: 'http://localhost:8080/v1',
        headers: { 'Content-Type': 'application/json' },
        modelName: 'phi-3-mini-4k-instruct'
      };
    }
    
    if (model === 'gemma-2-2b-it') {
      return {
        baseURL: 'http://localhost:8081/v1',
        headers: { 'Content-Type': 'application/json' },
        modelName: 'gemma-2-2b-it'
      };
    }
    
    return null;
  }
}

// Export singleton instance
export const localModelIntegration = new LocalModelIntegration();