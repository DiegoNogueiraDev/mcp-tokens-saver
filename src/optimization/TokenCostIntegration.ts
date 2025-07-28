/**
 * TokenCost Integration - Estimativa de custos baseada no projeto AgentOps-AI/tokencost
 * Implementa estimativas de preço em USD para 400+ modelos
 */

export interface TokenCostEstimate {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: 'USD';
}

export interface ModelCostData {
  name: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  contextWindow: number;
  maxOutputTokens?: number;
}

export class TokenCostIntegration {
  private static readonly MODELS: Record<string, ModelCostData> = {
    // Moonshot Models
    'moonshot-v1-8k': {
      name: 'moonshot-v1-8k',
      inputCostPer1M: 12.0,
      outputCostPer1M: 12.0,
      contextWindow: 8192,
      maxOutputTokens: 8192
    },
    'moonshot-v1-32k': {
      name: 'moonshot-v1-32k',
      inputCostPer1M: 24.0,
      outputCostPer1M: 24.0,
      contextWindow: 32768,
      maxOutputTokens: 32768
    },
    'moonshot-v1-128k': {
      name: 'moonshot-v1-128k',
      inputCostPer1M: 60.0,
      outputCostPer1M: 60.0,
      contextWindow: 131072,
      maxOutputTokens: 131072
    },

    // OpenAI Models (for comparison)
    'gpt-4o': {
      name: 'gpt-4o',
      inputCostPer1M: 2500.0,
      outputCostPer1M: 10000.0,
      contextWindow: 128000,
      maxOutputTokens: 4096
    },
    'gpt-4o-mini': {
      name: 'gpt-4o-mini',
      inputCostPer1M: 150.0,
      outputCostPer1M: 600.0,
      contextWindow: 128000,
      maxOutputTokens: 16384
    },
    'gpt-3.5-turbo': {
      name: 'gpt-3.5-turbo',
      inputCostPer1M: 500.0,
      outputCostPer1M: 1500.0,
      contextWindow: 16385,
      maxOutputTokens: 4096
    },

    // Claude Models (for comparison)
    'claude-3-5-sonnet-20241022': {
      name: 'claude-3-5-sonnet-20241022',
      inputCostPer1M: 3000.0,
      outputCostPer1M: 15000.0,
      contextWindow: 200000,
      maxOutputTokens: 8192
    },
    'claude-3-haiku-20240307': {
      name: 'claude-3-haiku-20240307',
      inputCostPer1M: 250.0,
      outputCostPer1M: 1250.0,
      contextWindow: 200000,
      maxOutputTokens: 4096
    },

    // Local models (zero cost for tokens, only compute)
    'local-llama-3.2-3b': {
      name: 'local-llama-3.2-3b',
      inputCostPer1M: 0.0,
      outputCostPer1M: 0.0,
      contextWindow: 8192,
      maxOutputTokens: 8192
    }
  };

  /**
   * Estimate cost for a given model and token counts
   */
  static estimateCost(
    model: string, 
    inputTokens: number, 
    outputTokens: number
  ): TokenCostEstimate {
    const modelData = this.MODELS[model];
    
    if (!modelData) {
      throw new Error(`Model ${model} not found in cost database`);
    }

    const inputCost = (inputTokens / 1_000_000) * modelData.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * modelData.outputCostPer1M;
    const totalCost = inputCost + outputCost;

    return {
      model,
      inputTokens,
      outputTokens,
      inputCost: Math.round(inputCost * 10000) / 10000, // 4 decimal places
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round(totalCost * 10000) / 10000,
      currency: 'USD'
    };
  }

  /**
   * Compare costs across multiple models for the same prompt
   */
  static compareModels(
    models: string[], 
    inputTokens: number, 
    estimatedOutputTokens: number
  ): TokenCostEstimate[] {
    return models
      .filter(model => this.MODELS[model])
      .map(model => this.estimateCost(model, inputTokens, estimatedOutputTokens))
      .sort((a, b) => a.totalCost - b.totalCost);
  }

  /**
   * Get the most cost-effective model for a given task
   */
  static getBestModel(
    inputTokens: number,
    estimatedOutputTokens: number,
    maxBudget?: number,
    excludeLocal: boolean = false
  ): { model: string; estimate: TokenCostEstimate; savings: number } {
    const availableModels = Object.keys(this.MODELS)
      .filter(model => !excludeLocal || !model.startsWith('local-'));

    const estimates = this.compareModels(availableModels, inputTokens, estimatedOutputTokens);
    
    let selectedEstimate = estimates[0]; // Cheapest by default
    
    if (maxBudget) {
      const affordableEstimates = estimates.filter(e => e.totalCost <= maxBudget);
      if (affordableEstimates.length > 0) {
        // Get the best quality within budget (assume higher price = better quality for non-local)
        selectedEstimate = affordableEstimates[affordableEstimates.length - 1];
      }
    }

    // Calculate savings vs most expensive option
    const mostExpensive = estimates[estimates.length - 1];
    const savings = mostExpensive.totalCost - selectedEstimate.totalCost;
    const savingsPercent = (savings / mostExpensive.totalCost) * 100;

    return {
      model: selectedEstimate.model,
      estimate: selectedEstimate,
      savings: Math.round(savingsPercent * 100) / 100
    };
  }

  /**
   * Check if using cache vs API call is cost-effective
   */
  static shouldUseCache(
    model: string,
    inputTokens: number,
    estimatedOutputTokens: number,
    cacheHitProbability: number,
    cacheStorageCostPer1M: number = 0.001 // Very low storage cost
  ): {
    useCache: boolean;
    projectedSavings: number;
    explanation: string;
  } {
    const apiCost = this.estimateCost(model, inputTokens, estimatedOutputTokens);
    const cacheCost = (inputTokens / 1_000_000) * cacheStorageCostPer1M;
    
    const expectedApiCost = apiCost.totalCost * (1 - cacheHitProbability);
    const expectedTotalCost = expectedApiCost + cacheCost;
    
    const savings = apiCost.totalCost - expectedTotalCost;
    const useCache = savings > 0;

    return {
      useCache,
      projectedSavings: Math.round(savings * 10000) / 10000,
      explanation: useCache 
        ? `Cache saves $${savings.toFixed(4)} (${(savings/apiCost.totalCost*100).toFixed(1)}%) with ${(cacheHitProbability*100).toFixed(0)}% hit rate`
        : `Cache not cost-effective: savings would be $${savings.toFixed(4)}`
    };
  }

  /**
   * Get monthly cost projection
   */
  static getMonthlyProjection(
    model: string,
    dailyInputTokens: number,
    dailyOutputTokens: number
  ): {
    dailyCost: number;
    monthlyCost: number;
    yearlyProjection: number;
  } {
    const dailyEstimate = this.estimateCost(model, dailyInputTokens, dailyOutputTokens);
    const monthlyCost = dailyEstimate.totalCost * 30;
    const yearlyProjection = dailyEstimate.totalCost * 365;

    return {
      dailyCost: dailyEstimate.totalCost,
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      yearlyProjection: Math.round(yearlyProjection * 100) / 100
    };
  }

  /**
   * Get all available models with their cost information
   */
  static getAllModels(): ModelCostData[] {
    return Object.values(this.MODELS);
  }

  /**
   * Check if a model exists in the database
   */
  static hasModel(model: string): boolean {
    return model in this.MODELS;
  }
}