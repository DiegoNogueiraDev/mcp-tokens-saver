import { ModelPricing, LLMProvider } from '../types/index.js';
import { Logger } from '../utils/Logger.js';

/**
 * Factory for creating and managing LLM providers
 */
export class LLMProviderFactory {
  private providers: Map<string, LLMProvider> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('LLMProviderFactory');
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Moonshot AI Provider
    this.providers.set('moonshot', {
      name: 'Moonshot AI',
      baseURL: 'https://api.moonshot.ai/v1',
      supportsStreaming: true,
      supportsCaching: true,
      models: [
        {
          name: 'moonshot-v1-8k',
          inputCostPer1M: 0.15,
          outputCostPer1M: 2.50,
          contextWindow: 8192,
          performance: 8.5,
          cachingSupport: true,
          recommended: ['coding', 'general', 'analysis']
        },
        {
          name: 'moonshot-v1-32k',
          inputCostPer1M: 0.30,
          outputCostPer1M: 3.00,
          contextWindow: 32768,
          performance: 8.7,
          cachingSupport: true,
          recommended: ['long-context', 'documents', 'code-review']
        },
        {
          name: 'moonshot-v1-128k',
          inputCostPer1M: 0.50,
          outputCostPer1M: 3.50,
          contextWindow: 128000,
          performance: 9.0,
          cachingSupport: true,
          recommended: ['complex-analysis', 'large-documents', 'agentic']
        }
      ]
    });

    // OpenAI Provider
    this.providers.set('openai', {
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      supportsStreaming: true,
      supportsCaching: false,
      models: [
        {
          name: 'gpt-4o',
          inputCostPer1M: 2.00,
          outputCostPer1M: 8.00,
          contextWindow: 128000,
          performance: 9.2,
          cachingSupport: false,
          recommended: ['premium-quality', 'complex-reasoning']
        },
        {
          name: 'gpt-4o-mini',
          inputCostPer1M: 0.15,
          outputCostPer1M: 0.60,
          contextWindow: 128000,
          performance: 8.0,
          cachingSupport: false,
          recommended: ['fast', 'cost-effective']
        },
        {
          name: 'gpt-3.5-turbo',
          inputCostPer1M: 0.50,
          outputCostPer1M: 1.50,
          contextWindow: 16385,
          performance: 7.5,
          cachingSupport: false,
          recommended: ['basic-tasks', 'high-volume']
        }
      ]
    });

    // Anthropic Provider
    this.providers.set('anthropic', {
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com/v1',
      supportsStreaming: true,
      supportsCaching: true,
      models: [
        {
          name: 'claude-3-opus',
          inputCostPer1M: 15.00,
          outputCostPer1M: 75.00,
          contextWindow: 200000,
          performance: 9.5,
          cachingSupport: true,
          recommended: ['complex-reasoning', 'creative-writing']
        },
        {
          name: 'claude-3-sonnet',
          inputCostPer1M: 3.00,
          outputCostPer1M: 15.00,
          contextWindow: 200000,
          performance: 9.0,
          cachingSupport: true,
          recommended: ['balanced-performance', 'analysis']
        },
        {
          name: 'claude-3-haiku',
          inputCostPer1M: 0.25,
          outputCostPer1M: 1.25,
          contextWindow: 200000,
          performance: 8.0,
          cachingSupport: true,
          recommended: ['fast-responses', 'simple-tasks']
        }
      ]
    });

    this.logger.info('LLM providers initialized', {
      count: this.providers.size,
      providers: Array.from(this.providers.keys())
    });

    // Initialize local model providers
    this.initializeLocalProviders();
  }

  private initializeLocalProviders(): void {
    // Local Phi-3-mini provider
    this.providers.set('local-phi3', {
      name: 'Local Phi-3-mini',
      baseURL: 'http://localhost:8080/v1',
      supportsStreaming: true,
      supportsCaching: true,
      models: [
        {
          name: 'phi-3-mini-4k-instruct',
          inputCostPer1M: 0,
          outputCostPer1M: 0,
          contextWindow: 4096,
          performance: 8.5,
          cachingSupport: true,
          recommended: ['coding', 'general', 'analysis', 'local']
        }
      ]
    });

    // Local Gemma-2 provider
    this.providers.set('local-gemma2', {
      name: 'Local Gemma-2-2B',
      baseURL: 'http://localhost:8081/v1',
      supportsStreaming: true,
      supportsCaching: true,
      models: [
        {
          name: 'gemma-2-2b-it',
          inputCostPer1M: 0,
          outputCostPer1M: 0,
          contextWindow: 4096,
          performance: 7.8,
          cachingSupport: true,
          recommended: ['fast', 'cost-effective', 'local', 'summarization']
        }
      ]
    });
  }

  /**
   * Gets all available providers
   */
  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Gets a specific provider
   */
  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Gets all models from all providers
   */
  getAllModels(): ModelPricing[] {
    const allModels: ModelPricing[] = [];
    
    for (const provider of this.providers.values()) {
      allModels.push(...provider.models);
    }
    
    return allModels;
  }

  /**
   * Finds the most cost-effective model for a given task
   */
  findCostEffectiveModel(
    taskType: string,
    maxBudget?: number,
    minPerformance?: number
  ): ModelPricing | null {
    let candidates = this.getAllModels();
    
    // Filter by task type
    if (taskType !== 'general') {
      candidates = candidates.filter(model => 
        model.recommended.includes(taskType) || 
        model.recommended.includes('general')
      );
    }
    
    // Filter by performance requirement
    if (minPerformance) {
      candidates = candidates.filter(model => model.performance >= minPerformance);
    }
    
    // Filter by budget (estimate for 1M tokens)
    if (maxBudget) {
      candidates = candidates.filter(model => {
        const estimatedCost = (model.inputCostPer1M * 0.7) + (model.outputCostPer1M * 0.3);
        return estimatedCost <= maxBudget;
      });
    }
    
    if (candidates.length === 0) return null;
    
    // Sort by cost efficiency (performance per dollar)
    candidates.sort((a, b) => {
      const costA = (a.inputCostPer1M * 0.7) + (a.outputCostPer1M * 0.3);
      const costB = (b.inputCostPer1M * 0.7) + (b.outputCostPer1M * 0.3);
      const efficiencyA = a.performance / costA;
      const efficiencyB = b.performance / costB;
      return efficiencyB - efficiencyA;
    });
    
    return candidates[0];
  }

  /**
   * Compares models across providers
   */
  compareModels(modelNames: string[]): {
    comparison: Array<{
      model: ModelPricing;
      provider: string;
      cost_per_1m_tokens: number;
      performance_per_dollar: number;
      recommended_for: string[];
    }>;
    best_value: string;
    cheapest: string;
    highest_performance: string;
  } {
    const comparison: Array<{
      model: ModelPricing;
      provider: string;
      cost_per_1m_tokens: number;
      performance_per_dollar: number;
      recommended_for: string[];
    }> = [];

    // Find models across all providers
    for (const [providerName, provider] of this.providers.entries()) {
      for (const model of provider.models) {
        if (modelNames.length === 0 || modelNames.includes(model.name)) {
          const cost = (model.inputCostPer1M * 0.7) + (model.outputCostPer1M * 0.3);
          comparison.push({
            model,
            provider: providerName,
            cost_per_1m_tokens: cost,
            performance_per_dollar: model.performance / cost,
            recommended_for: model.recommended
          });
        }
      }
    }

    // Find best options
    const bestValue = comparison.reduce((best, current) => 
      current.performance_per_dollar > best.performance_per_dollar ? current : best
    );
    
    const cheapest = comparison.reduce((best, current) => 
      current.cost_per_1m_tokens < best.cost_per_1m_tokens ? current : best
    );
    
    const highestPerformance = comparison.reduce((best, current) => 
      current.model.performance > best.model.performance ? current : best
    );

    return {
      comparison,
      best_value: bestValue.model.name,
      cheapest: cheapest.model.name,
      highest_performance: highestPerformance.model.name
    };
  }

  /**
   * Gets provider-specific configuration for API calls
   */
  getProviderConfig(modelName: string): {
    provider: LLMProvider;
    model: ModelPricing;
    baseURL: string;
    headers: Record<string, string>;
  } | null {
    for (const provider of this.providers.values()) {
      const model = provider.models.find(m => m.name === modelName);
      if (model) {
        return {
          provider,
          model,
          baseURL: provider.baseURL,
          headers: this.getProviderHeaders(provider.name)
        };
      }
    }
    return null;
  }

  private getProviderHeaders(providerName: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (providerName) {
      case 'moonshot':
        if (process.env.MOONSHOT_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.MOONSHOT_API_KEY}`;
        }
        break;
      case 'openai':
        if (process.env.OPENAI_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
        }
        break;
      case 'anthropic':
        if (process.env.ANTHROPIC_API_KEY) {
          headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
          headers['anthropic-version'] = '2023-06-01';
        }
        break;
    }

    return headers;
  }

  /**
   * Adds a custom provider
   */
  addProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
    this.logger.info('Custom provider added', { name, models: provider.models.length });
  }

  /**
   * Updates provider information
   */
  updateProvider(name: string, updates: Partial<LLMProvider>): void {
    const existing = this.providers.get(name);
    if (existing) {
      this.providers.set(name, { ...existing, ...updates });
      this.logger.info('Provider updated', { name });
    }
  }

  /**
   * Gets cost analysis for different usage patterns
   */
  getCostAnalysis(
    tokensPerMonth: number,
    inputOutputRatio: number = 0.7
  ): Array<{
    model: string;
    provider: string;
    monthly_cost: number;
    cost_per_request: number;
    performance: number;
  }> {
    const analysis: Array<{
      model: string;
      provider: string;
      monthly_cost: number;
      cost_per_request: number;
      performance: number;
    }> = [];

    const inputTokens = tokensPerMonth * inputOutputRatio;
    const outputTokens = tokensPerMonth * (1 - inputOutputRatio);

    for (const [providerName, provider] of this.providers.entries()) {
      for (const model of provider.models) {
        const monthlyCost = 
          (inputTokens * model.inputCostPer1M / 1000000) +
          (outputTokens * model.outputCostPer1M / 1000000);

        analysis.push({
          model: model.name,
          provider: providerName,
          monthly_cost: monthlyCost,
          cost_per_request: monthlyCost / (tokensPerMonth / 1000), // Assuming 1k tokens per request
          performance: model.performance
        });
      }
    }

    return analysis.sort((a, b) => a.monthly_cost - b.monthly_cost);
  }
}