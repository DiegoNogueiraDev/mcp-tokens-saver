import { Logger } from '../utils/Logger.js';
import { LocalModelManager } from '../providers/LocalModelManager.js';
import { LLMProviderFactory } from '../providers/LLMProviderFactory.js';
import { ModelPricing } from '../types/index.js';

export interface RoutingDecision {
  selectedModel: string;
  selectedProvider: string;
  reason: string;
  estimatedCost: number;
  localModelUsed: boolean;
  fallbackModel?: string;
}

export interface RoutingOptions {
  maxCostThreshold?: number;
  minPerformance?: number;
  preferLocal?: boolean;
  forceLocal?: boolean;
  forceRemote?: boolean;
  contextTokens?: number;
}

export class LocalModelRouter {
  private logger: Logger;
  private localManager: LocalModelManager;
  private providerFactory: LLMProviderFactory;

  constructor() {
    this.logger = new Logger('LocalModelRouter');
    this.localManager = new LocalModelManager();
    this.providerFactory = new LLMProviderFactory();
  }

  /**
   * Make routing decision based on cost and performance criteria
   */
  async routeRequest(
    taskType: string,
    options: RoutingOptions = {}
  ): Promise<RoutingDecision> {
    const {
      maxCostThreshold = 0.002, // $0.002 USD threshold from INSIGHTS-V2.md
      minPerformance = 7.0,
      preferLocal = true,
      forceLocal = false,
      forceRemote = false,
      contextTokens = 0
    } = options;

    this.logger.info('Making routing decision', { taskType, options });

    // Check available local models
    const availableLocalModels = await this.localManager.autoDetectModels();
    const localModels = this.getLocalModelConfigs();

    // Force remote if specified
    if (forceRemote) {
      return this.selectRemoteModel(taskType, maxCostThreshold, minPerformance);
    }

    // Force local if specified
    if (forceLocal) {
      const localDecision = this.selectLocalModel(taskType, availableLocalModels, localModels);
      if (localDecision) return localDecision;
      
      return {
        selectedModel: 'gpt-4o-mini',
        selectedProvider: 'openai',
        reason: 'Forced local but no local models available',
        estimatedCost: 0.15,
        localModelUsed: false,
        fallbackModel: 'gpt-4o-mini'
      };
    }

    // Check if we should use local based on cost threshold
    const remoteCost = this.estimateRemoteCost(taskType, contextTokens);
    
    if (preferLocal && remoteCost > maxCostThreshold) {
      const localDecision = this.selectLocalModel(taskType, availableLocalModels, localModels);
      if (localDecision) {
        this.logger.info('Selecting local model due to cost threshold', { 
          remoteCost, 
          threshold: maxCostThreshold 
        });
        return localDecision;
      }
    }

    // Check if we should use local based on context size
    if (contextTokens > 1024 && preferLocal) {
      const localDecision = this.selectLocalModel(taskType, availableLocalModels, localModels);
      if (localDecision) {
        this.logger.info('Selecting local model due to large context', { contextTokens });
        return localDecision;
      }
    }

    // Default to remote model
    return this.selectRemoteModel(taskType, maxCostThreshold, minPerformance);
  }

  /**
   * Select appropriate local model
   */
  private selectLocalModel(
    taskType: string,
    availableModels: string[],
    modelConfigs: Map<string, any>
  ): RoutingDecision | null {
    if (availableModels.length === 0) {
      return null;
    }

    // Priority: Phi-3-mini for complex tasks, Gemma-2 for simple tasks
    let selectedModel: string;
    
    if (availableModels.includes('phi-3-mini-4k-instruct') && 
        ['coding', 'analysis', 'complex-reasoning'].includes(taskType)) {
      selectedModel = 'phi-3-mini-4k-instruct';
    } else if (availableModels.includes('gemma-2-2b-it')) {
      selectedModel = 'gemma-2-2b-it';
    } else {
      selectedModel = availableModels[0];
    }

    const config = modelConfigs.get(selectedModel);
    if (!config) return null;

    return {
      selectedModel,
      selectedProvider: selectedModel === 'phi-3-mini-4k-instruct' ? 'local-phi3' : 'local-gemma2',
      reason: `Cost-effective local model for ${taskType}`,
      estimatedCost: 0,
      localModelUsed: true
    };
  }

  /**
   * Select appropriate remote model
   */
  private selectRemoteModel(
    taskType: string,
    maxCost: number,
    minPerformance: number
  ): RoutingDecision {
    const remoteModel = this.providerFactory.findCostEffectiveModel(
      taskType,
      maxCost,
      minPerformance
    );

    if (remoteModel) {
      const provider = this.providerFactory.getProviderConfig(remoteModel.name);
      return {
        selectedModel: remoteModel.name,
        selectedProvider: provider?.provider.name.toLowerCase() || 'unknown',
        reason: 'Cost-effective remote model',
        estimatedCost: this.calculateEstimatedCost(remoteModel),
        localModelUsed: false
      };
    }

    // Fallback to cheapest available
    const allModels = this.providerFactory.getAllModels();
    const cheapest = allModels.reduce((prev, curr) => 
      (prev.inputCostPer1M + prev.outputCostPer1M) < (curr.inputCostPer1M + curr.outputCostPer1M) ? prev : curr
    );

    return {
      selectedModel: cheapest.name,
      selectedProvider: 'fallback',
      reason: 'Fallback to cheapest available',
      estimatedCost: this.calculateEstimatedCost(cheapest),
      localModelUsed: false
    };
  }

  /**
   * Estimate cost for remote model usage
   */
  private estimateRemoteCost(taskType: string, contextTokens: number): number {
    const model = this.providerFactory.findCostEffectiveModel(taskType);
    if (!model) return 0;

    // Estimate cost for 1M tokens
    const estimatedTokens = Math.max(contextTokens, 1000);
    const costPerToken = (model.inputCostPer1M + model.outputCostPer1M) / 2_000_000;
    
    return estimatedTokens * costPerToken;
  }

  /**
   * Calculate estimated cost for a model
   */
  private calculateEstimatedCost(model: ModelPricing): number {
    return (model.inputCostPer1M + model.outputCostPer1M) / 2_000_000; // Per token
  }

  /**
   * Get local model configurations
   */
  private getLocalModelConfigs(): Map<string, any> {
    const configs = new Map();
    
    configs.set('phi-3-mini-4k-instruct', {
      name: 'Phi-3-mini-4k-instruct',
      parameters: '3.8B',
      ramUsage: 5800,
      performance: 8.5
    });
    
    configs.set('gemma-2-2b-it', {
      name: 'Gemma-2-2B-IT',
      parameters: '2B',
      ramUsage: 4000,
      performance: 7.8
    });
    
    return configs;
  }

  /**
   * Get system RAM information
   */
  async getSystemRAM(): Promise<number> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('free -m', { encoding: 'utf8' });
      const lines = output.split('\n');
      const memLine = lines[1].split(/\s+/);
      const totalRAM = parseInt(memLine[1], 10);
      
      return totalRAM;
    } catch (error) {
      this.logger.warn('Could not determine system RAM', { error });
      return 8192; // Default assumption
    }
  }

  /**
   * Check if local models are healthy and available
   */
  async checkLocalModelsHealth(): Promise<Record<string, boolean>> {
    const statuses = await this.localManager.getModelStatuses();
    const health: Record<string, boolean> = {};
    
    for (const status of statuses) {
      if (status.isDownloaded && status.isRunning && status.health === 'healthy') {
        health[status.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')] = true;
      }
    }
    
    return health;
  }

  /**
   * Get routing recommendations
   */
  async getRecommendations(): Promise<{
    localAvailable: string[];
    remoteAvailable: string[];
    recommendedStrategy: string;
    estimatedSavings: number;
  }> {
    const localAvailable = await this.localManager.autoDetectModels();
    const remoteAvailable = this.providerFactory.getAllModels().map(m => m.name);
    
    const systemRAM = await this.getSystemRAM();
    const recommendedModel = this.localManager.getRecommendedModel(systemRAM);
    
    let strategy: string;
    let savings = 0;
    
    if (recommendedModel && localAvailable.includes(recommendedModel)) {
      strategy = `Use local ${recommendedModel} for cost savings`;
      savings = 100; // 100% savings vs remote
    } else if (localAvailable.length > 0) {
      strategy = `Use available local models: ${localAvailable.join(', ')}`;
      savings = 100;
    } else {
      strategy = 'Use remote models - no local models available';
      savings = 0;
    }
    
    return {
      localAvailable,
      remoteAvailable,
      recommendedStrategy: strategy,
      estimatedSavings: savings
    };
  }
}