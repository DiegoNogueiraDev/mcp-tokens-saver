/**
 * Otimizador inteligente de modelos baseado em custo/performance
 * Baseado na análise da documentação Moonshot AI 2025
 * Integrado com TokenCost e SmartRouter para máxima economia
 */

import { TokenCostIntegration, TokenCostEstimate } from '../optimization/TokenCostIntegration.js';
import { SmartRouter, RoutingDecision, RoutingOptions } from '../optimization/SmartRouter.js';
import { ContextCompression, CompressionResult } from '../optimization/ContextCompression.js';
import { LocalModelRouter } from './LocalModelRouter.js';

export interface ModelPricing {
  name: string;
  inputCostPer1M: number;  // USD per 1M tokens
  outputCostPer1M: number; // USD per 1M tokens
  contextWindow: number;   // Max tokens
  performance: number;     // Score 1-10 (benchmarks)
  cachingSupport: boolean;
  recommended: string[];   // Use cases
}

export interface OptimizationStrategy {
  model: string;
  reason: string;
  expectedSavings: number;
  fallbackModel?: string;
  useCache: boolean;
}

export class ModelOptimizer {
private models: Map<string, ModelPricing> = new Map();
private smartRouter: SmartRouter;
private localModelRouter: LocalModelRouter;

constructor() {
  this.initializeModels();
  this.localModelRouter = new LocalModelRouter();
  
  // Initialize smart router with current cache and local model info
  this.smartRouter = new SmartRouter(
    {
      hitProbability: 0.3,
      averageLatency: 50,
      costPerHit: 0.0001
    },
    {
      available: false, // Will be updated based on environment
      model: 'local-llama-3.2-3b',
      averageLatency: 2000,
      qualityScore: 0.7
    }
  );
  
  // Initialize local model detection
  this.initializeLocalModels();
}

private async initializeLocalModels(): Promise<void> {
  try {
    const localHealth = await this.localModelRouter.checkLocalModelsHealth();
    const hasLocalModels = Object.keys(localHealth).length > 0;
    
    this.smartRouter.updateLocalModelInfo({
      available: hasLocalModels,
      model: hasLocalModels ? 'local-phi3' : 'local-llama-3.2-3b',
      averageLatency: hasLocalModels ? 1000 : 2000,
      qualityScore: hasLocalModels ? 0.85 : 0.7
    });
  } catch (error) {
    console.warn('Failed to initialize local models:', error);
  }
}

  private initializeModels() {
    // Moonshot AI Models (2025 pricing)
    this.models.set('moonshot-v1-8k', {
      name: 'Moonshot v1 8K',
      inputCostPer1M: 0.15,
      outputCostPer1M: 2.50,
      contextWindow: 8192,
      performance: 8.5,
      cachingSupport: true,
      recommended: ['coding', 'general', 'analysis']
    });

    this.models.set('moonshot-v1-32k', {
      name: 'Moonshot v1 32K',
      inputCostPer1M: 0.30,
      outputCostPer1M: 3.00,
      contextWindow: 32768,
      performance: 8.7,
      cachingSupport: true,
      recommended: ['long-context', 'documents', 'code-review']
    });

    this.models.set('moonshot-v1-128k', {
      name: 'Moonshot v1 128K',
      inputCostPer1M: 0.50,
      outputCostPer1M: 3.50,
      contextWindow: 128000,
      performance: 9.0,
      cachingSupport: true,
      recommended: ['complex-analysis', 'large-documents', 'agentic']
    });

    // Competitors for comparison
    this.models.set('gpt-4o', {
      name: 'GPT-4o',
      inputCostPer1M: 2.00,
      outputCostPer1M: 8.00,
      contextWindow: 128000,
      performance: 9.2,
      cachingSupport: false,
      recommended: ['premium-quality']
    });

    this.models.set('claude-3-opus', {
      name: 'Claude 3 Opus',
      inputCostPer1M: 15.00,
      outputCostPer1M: 75.00,
      contextWindow: 200000,
      performance: 9.5,
      cachingSupport: false,
      recommended: ['complex-reasoning']
    });

    // Local models (zero cost)
    this.models.set('phi-3-mini-4k-instruct', {
      name: 'Phi-3-mini-4k-instruct (Local)',
      inputCostPer1M: 0.00,
      outputCostPer1M: 0.00,
      contextWindow: 4096,
      performance: 8.5,
      cachingSupport: true,
      recommended: ['local', 'coding', 'analysis', 'cost-effective']
    });

    this.models.set('gemma-2-2b-it', {
      name: 'Gemma-2-2B-IT (Local)',
      inputCostPer1M: 0.00,
      outputCostPer1M: 0.00,
      contextWindow: 4096,
      performance: 7.8,
      cachingSupport: true,
      recommended: ['local', 'fast', 'summarization', 'cost-effective']
    });
  }

  /**
   * Otimiza seleção de modelo baseado no contexto da tarefa
   */
  optimizeModelSelection(
    taskType: string,
    promptTokens: number,
    contextTokens: number,
    qualityRequirement: 'fast' | 'balanced' | 'premium' = 'balanced',
    budgetConstraint?: number // USD
  ): OptimizationStrategy {
    
    const totalTokens = promptTokens + contextTokens;
    const availableModels = Array.from(this.models.values());
    
    // Filtra modelos por contexto disponível
    const viableModels = availableModels.filter(model => 
      model.contextWindow >= totalTokens
    );

    if (viableModels.length === 0) {
      throw new Error(`No model can handle ${totalTokens} tokens`);
    }

    // Estratégias de otimização baseadas no tipo de tarefa
    let strategy: OptimizationStrategy;

    switch (taskType.toLowerCase()) {
      case 'coding':
      case 'code-review':
      case 'debugging':
        strategy = this.optimizeForCoding(viableModels, totalTokens, qualityRequirement);
        break;
        
      case 'analysis':
      case 'documentation':
      case 'explanation':
        strategy = this.optimizeForAnalysis(viableModels, totalTokens, qualityRequirement);
        break;
        
      case 'long-context':
      case 'document-processing':
        strategy = this.optimizeForLongContext(viableModels, totalTokens, qualityRequirement);
        break;
        
      default:
        strategy = this.optimizeGeneral(viableModels, totalTokens, qualityRequirement);
    }

    // Aplica restrições de orçamento
    if (budgetConstraint) {
      strategy = this.applyBudgetConstraint(strategy, viableModels, totalTokens, budgetConstraint);
    }

    return strategy;
  }

  private optimizeForCoding(
    models: ModelPricing[], 
    totalTokens: number, 
    quality: 'fast' | 'balanced' | 'premium'
  ): OptimizationStrategy {
    
    // Para coding, Moonshot é muito competitivo
    const moonshot8k = models.find(m => m.name.includes('Moonshot v1 8K'));
    const moonshot32k = models.find(m => m.name.includes('Moonshot v1 32K'));

    if (totalTokens <= 6000 && moonshot8k) {
      return {
        model: 'moonshot-v1-8k',
        reason: 'Optimal for coding tasks: 13x cheaper than GPT-4, excellent code performance',
        expectedSavings: this.calculateSavings('moonshot-v1-8k', 'gpt-4o', totalTokens),
        useCache: true
      };
    }

    if (totalTokens <= 25000 && moonshot32k) {
      return {
        model: 'moonshot-v1-32k',
        reason: 'Best balance for larger code contexts: 7x cheaper than GPT-4',
        expectedSavings: this.calculateSavings('moonshot-v1-32k', 'gpt-4o', totalTokens),
        fallbackModel: 'moonshot-v1-8k',
        useCache: true
      };
    }

    return {
      model: 'moonshot-v1-128k',
      reason: 'Large codebase analysis: Still 4x cheaper than alternatives',
      expectedSavings: this.calculateSavings('moonshot-v1-128k', 'gpt-4o', totalTokens),
      fallbackModel: 'moonshot-v1-32k',
      useCache: true
    };
  }

  private optimizeForAnalysis(
    models: ModelPricing[], 
    totalTokens: number, 
    quality: 'fast' | 'balanced' | 'premium'
  ): OptimizationStrategy {
    
    if (quality === 'fast' || totalTokens <= 8000) {
      return {
        model: 'moonshot-v1-8k',
        reason: 'Fast analysis: 13x cost reduction vs GPT-4 with similar quality',
        expectedSavings: this.calculateSavings('moonshot-v1-8k', 'gpt-4o', totalTokens),
        useCache: true
      };
    }

    if (quality === 'balanced' && totalTokens <= 32000) {
      return {
        model: 'moonshot-v1-32k',
        reason: 'Balanced analysis: Superior performance/cost ratio',
        expectedSavings: this.calculateSavings('moonshot-v1-32k', 'gpt-4o', totalTokens),
        fallbackModel: 'moonshot-v1-8k',
        useCache: true
      };
    }

    return {
      model: 'moonshot-v1-128k',
      reason: 'Premium analysis: 20x cheaper than Claude Opus with comparable results',
      expectedSavings: this.calculateSavings('moonshot-v1-128k', 'claude-3-opus', totalTokens),
      useCache: true
    };
  }

  private optimizeForLongContext(
    models: ModelPricing[], 
    totalTokens: number, 
    quality: 'fast' | 'balanced' | 'premium'
  ): OptimizationStrategy {
    
    return {
      model: 'moonshot-v1-128k',
      reason: 'Long context specialist: 128K window at fraction of competitor costs',
      expectedSavings: this.calculateSavings('moonshot-v1-128k', 'claude-3-opus', totalTokens),
      fallbackModel: 'moonshot-v1-32k',
      useCache: true
    };
  }

  private optimizeGeneral(
    models: ModelPricing[], 
    totalTokens: number, 
    quality: 'fast' | 'balanced' | 'premium'
  ): OptimizationStrategy {
    
    const costEffective = models
      .filter(m => m.name.includes('Moonshot'))
      .sort((a, b) => (a.inputCostPer1M + a.outputCostPer1M) - (b.inputCostPer1M + b.outputCostPer1M));

    const selected = costEffective[0];
    const modelKey = this.getModelKey(selected.name);

    return {
      model: modelKey,
      reason: 'Cost-optimized general purpose: Best value proposition in market',
      expectedSavings: this.calculateSavings(modelKey, 'gpt-4o', totalTokens),
      useCache: true
    };
  }

  private applyBudgetConstraint(
    strategy: OptimizationStrategy,
    models: ModelPricing[],
    totalTokens: number,
    budget: number
  ): OptimizationStrategy {
    
    const selectedModel = this.models.get(strategy.model);
    if (!selectedModel) return strategy;

    const estimatedCost = this.calculateCost(selectedModel, totalTokens);
    
    if (estimatedCost <= budget) {
      return strategy;
    }

    // Encontra alternativa mais barata
    const cheaperModels = models
      .filter(m => this.calculateCost(m, totalTokens) <= budget)
      .sort((a, b) => b.performance - a.performance);

    if (cheaperModels.length > 0) {
      const alternative = cheaperModels[0];
      return {
        model: this.getModelKey(alternative.name),
        reason: `Budget constraint: Selected cheaper alternative within $${budget} budget`,
        expectedSavings: budget - this.calculateCost(alternative, totalTokens),
        useCache: true
      };
    }

    return {
      ...strategy,
      reason: strategy.reason + ` (WARNING: Exceeds $${budget} budget by $${(estimatedCost - budget).toFixed(4)})`
    };
  }

  private calculateSavings(modelA: string, modelB: string, totalTokens: number): number {
    const costA = this.calculateCost(this.models.get(modelA)!, totalTokens);
    const costB = this.calculateCost(this.models.get(modelB)!, totalTokens);
    return ((costB - costA) / costB) * 100;
  }

  private calculateCost(model: ModelPricing, totalTokens: number): number {
    // Assume 70% input, 30% output ratio
    const inputTokens = totalTokens * 0.7;
    const outputTokens = totalTokens * 0.3;
    
    return (inputTokens * model.inputCostPer1M / 1000000) + 
           (outputTokens * model.outputCostPer1M / 1000000);
  }

  private getModelKey(modelName: string): string {
    if (modelName.includes('8K')) return 'moonshot-v1-8k';
    if (modelName.includes('32K')) return 'moonshot-v1-32k';
    if (modelName.includes('128K')) return 'moonshot-v1-128k';
    if (modelName.includes('GPT-4')) return 'gpt-4o';
    if (modelName.includes('Claude')) return 'claude-3-opus';
    return 'moonshot-v1-8k';
  }

  /**
   * Estratégias anti cache-miss para maximizar economia
   */
  getCacheMissOptimization(
    missReason: string,
    originalModel: string,
    taskType: string
  ): OptimizationStrategy {
    
    // Se o cache miss for por contexto muito específico, use modelo menor
    if (missReason.includes('context') || missReason.includes('specific')) {
      return {
        model: 'moonshot-v1-8k',
        reason: 'Cache miss optimization: Use fastest/cheapest model for specific contexts',
        expectedSavings: 85, // vs competitors
        useCache: false // Para contextos únicos
      };
    }

    // Se for por complexidade, use modelo intermediário
    if (missReason.includes('complex') || missReason.includes('large')) {
      return {
        model: 'moonshot-v1-32k',
        reason: 'Cache miss optimization: Balanced model for complex unique tasks',
        expectedSavings: 75,
        useCache: true
      };
    }

    // Fallback para modelo padrão otimizado
    return this.optimizeModelSelection(taskType, 1000, 500, 'fast');
  }

  /**
   * Análise de ROI do cache vs modelo mais barato
   */
  analyzeCacheROI(
    cacheHitRate: number,
    averageTokens: number,
    requestsPerDay: number
  ): {
    useCache: boolean;
    projectedSavings: number;
    recommendation: string;
  } {
    
    const cacheOverhead = 0.1; // 10% overhead for cache operations
    const effectiveHitRate = cacheHitRate * (1 - cacheOverhead);
    
    if (effectiveHitRate > 0.3) { // 30% hit rate threshold
      return {
        useCache: true,
        projectedSavings: effectiveHitRate * 0.8 * 100, // 80% savings on hits
        recommendation: 'Cache is highly beneficial - maintain aggressive caching'
      };
    }

    if (effectiveHitRate > 0.15) {
      return {
        useCache: true,
        projectedSavings: effectiveHitRate * 0.6 * 100,
        recommendation: 'Cache provides moderate benefits - optimize heuristics'
      };
    }

    return {
      useCache: false,
      projectedSavings: 0,
      recommendation: 'Low cache efficiency - focus on model optimization instead'
    };
  }

  getModelComparison(): ModelPricing[] {
    return Array.from(this.models.values());
  }

  /**
   * Otimização avançada usando SmartRouter e TokenCost integration
   */
  async getAdvancedOptimization(
    prompt: string,
    context: string = '',
    options: RoutingOptions = {}
  ): Promise<{
    routing: RoutingDecision;
    costEstimate: TokenCostEstimate;
    compression?: CompressionResult;
    recommendations: string[];
  }> {
    // Get routing decision from SmartRouter
    const routing = this.smartRouter.route(prompt, context, options);
    
    // Get cost estimate using TokenCost integration
    const inputTokens = Math.ceil((prompt + context).length / 4.5);
    const outputTokens = this.estimateOutputTokens(prompt, options.taskType || 'general');
    const costEstimate = TokenCostIntegration.estimateCost(
      routing.model,
      inputTokens,
      outputTokens
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(routing, costEstimate, options);

    return {
      routing,
      costEstimate,
      compression: routing.compression,
      recommendations
    };
  }

  /**
   * Análise de custo-benefício com TokenCost integration
   */
  getCostBenefitAnalysis(
    prompt: string,
    context: string = '',
    candidateModels: string[] = ['moonshot-v1-8k', 'moonshot-v1-32k', 'gpt-4o']
  ): {
    analysis: Array<{
      model: string;
      estimate: TokenCostEstimate;
      qualityScore: number;
      recommendation: string;
    }>;
    bestOption: string;
    savings: {
      vsExpensive: number;
      vsMidRange: number;
    };
  } {
    const inputTokens = Math.ceil((prompt + context).length / 4.5);
    const outputTokens = this.estimateOutputTokens(prompt, 'general');

    const analysis = candidateModels
      .filter(model => TokenCostIntegration.hasModel(model))
      .map(model => {
        const estimate = TokenCostIntegration.estimateCost(model, inputTokens, outputTokens);
        const qualityScore = this.getQualityScore(model);
        const valueScore = qualityScore / estimate.totalCost;
        
        return {
          model,
          estimate,
          qualityScore,
          valueScore,
          recommendation: this.getModelRecommendation(model, valueScore)
        };
      })
      .sort((a, b) => b.valueScore - a.valueScore);

    const bestOption = analysis[0]?.model || 'moonshot-v1-8k';
    const mostExpensive = analysis.reduce((max, curr) => 
      curr.estimate.totalCost > max.estimate.totalCost ? curr : max, analysis[0]);
    const midRange = analysis[Math.floor(analysis.length / 2)];

    return {
      analysis,
      bestOption,
      savings: {
        vsExpensive: mostExpensive ? 
          ((mostExpensive.estimate.totalCost - analysis[0].estimate.totalCost) / mostExpensive.estimate.totalCost) * 100 : 0,
        vsMidRange: midRange ? 
          ((midRange.estimate.totalCost - analysis[0].estimate.totalCost) / midRange.estimate.totalCost) * 100 : 0
      }
    };
  }

  /**
   * Compressão inteligente de contexto
   */
  async compressContext(
    text: string,
    targetTokenReduction: number = 30, // 30% reduction by default
    contextType: 'conversation' | 'documentation' | 'code' | 'general' = 'general'
  ): Promise<CompressionResult> {
    const originalTokens = Math.ceil(text.length / 4.5);
    const targetTokens = Math.floor(originalTokens * (1 - targetTokenReduction / 100));

    return ContextCompression.smartCompress(text, targetTokens, {
      contextType,
      aggressiveness: targetTokenReduction > 50 ? 'aggressive' : 
                      targetTokenReduction > 25 ? 'moderate' : 'conservative'
    });
  }

  /**
   * Análise de economias mensais projetadas
   */
  async getMonthlyProjections(
    dailyRequests: number,
    averagePromptLength: number,
    taskTypes: Record<string, number> = { general: 1.0 }
  ): Promise<{
    baseline: { model: string; monthlyCost: number; };
    optimized: { model: string; monthlyCost: number; };
    withCache: { hitRate: number; monthlyCost: number; };
    withLocal: { available: boolean; monthlyCost: number; };
    totalSavings: {
      amount: number;
      percentage: number;
      breakdown: {
        modelOptimization: number;
        caching: number;
        localFallback: number;
      };
    };
  }> {
    const inputTokens = Math.ceil(averagePromptLength / 4.5);
    const outputTokens = this.estimateOutputTokens('', 'general');

    // Baseline: GPT-4o (expensive option)
    const baselineDaily = TokenCostIntegration.estimateCost('gpt-4o', inputTokens, outputTokens).totalCost * dailyRequests;
    const baselineMonthly = baselineDaily * 30;

    // Optimized: Best Moonshot model
    const optimizedDaily = TokenCostIntegration.estimateCost('moonshot-v1-8k', inputTokens, outputTokens).totalCost * dailyRequests;
    const optimizedMonthly = optimizedDaily * 30;

    // With cache (30% hit rate)
    const cacheHitRate = 0.3;
    const withCacheDaily = optimizedDaily * (1 - cacheHitRate * 0.9); // 90% savings on hits
    const withCacheMonthly = withCacheDaily * 30;

    // With local model (if available)
    const localHealth = await this.localModelRouter.checkLocalModelsHealth();
    const localAvailable = Object.keys(localHealth).length > 0;
    const withLocalDaily = localAvailable ? 0 : optimizedDaily; // 100% savings when local
    const withLocalMonthly = withLocalDaily * 30;

    const totalSavingsAmount = baselineMonthly - Math.min(withCacheMonthly, withLocalMonthly);
    const totalSavingsPercentage = (totalSavingsAmount / baselineMonthly) * 100;

    return {
      baseline: { model: 'gpt-4o', monthlyCost: baselineMonthly },
      optimized: { model: 'moonshot-v1-8k', monthlyCost: optimizedMonthly },
      withCache: { hitRate: cacheHitRate, monthlyCost: withCacheMonthly },
      withLocal: { available: localAvailable, monthlyCost: withLocalMonthly },
      totalSavings: {
        amount: totalSavingsAmount,
        percentage: totalSavingsPercentage,
        breakdown: {
          modelOptimization: ((baselineMonthly - optimizedMonthly) / baselineMonthly) * 100,
          caching: ((optimizedMonthly - withCacheMonthly) / baselineMonthly) * 100,
          localFallback: localAvailable ? ((withCacheMonthly - withLocalMonthly) / baselineMonthly) * 100 : 0
        }
      }
    };
  }

  /**
   * Update cache and local model information for smart routing
   */
  updateRoutingInfo(
    cacheHitRate?: number,
    cacheLatency?: number,
    localModelAvailable?: boolean,
    localModelLatency?: number
  ): void {
    if (cacheHitRate !== undefined || cacheLatency !== undefined) {
      this.smartRouter.updateCacheInfo({
        ...(cacheHitRate !== undefined && { hitProbability: cacheHitRate }),
        ...(cacheLatency !== undefined && { averageLatency: cacheLatency })
      });
    }

    if (localModelAvailable !== undefined || localModelLatency !== undefined) {
      this.smartRouter.updateLocalModelInfo({
        ...(localModelAvailable !== undefined && { available: localModelAvailable }),
        ...(localModelLatency !== undefined && { averageLatency: localModelLatency })
      });
    }
  }

  private estimateOutputTokens(prompt: string, taskType: string): number {
    const promptTokens = Math.ceil(prompt.length / 4.5);
    const ratios: Record<string, number> = {
      'coding': 2.0,
      'analysis': 1.5,
      'documentation': 2.5,
      'long-context': 0.3,
      'general': 1.0
    };
    return Math.floor(promptTokens * (ratios[taskType] || 1.0));
  }

  private getQualityScore(model: string): number {
    const scores: Record<string, number> = {
      'moonshot-v1-8k': 0.85,
      'moonshot-v1-32k': 0.9,
      'moonshot-v1-128k': 0.95,
      'gpt-4o': 1.0,
      'claude-3-opus': 0.95,
      'local-llama-3.2-3b': 0.7
    };
    return scores[model] || 0.8;
  }

  private getModelRecommendation(model: string, valueScore: number): string {
    if (valueScore > 100) return 'Excelente custo-benefício - altamente recomendado';
    if (valueScore > 50) return 'Bom custo-benefício - recomendado';
    if (valueScore > 20) return 'Custo-benefício moderado - considerar alternativas';
    return 'Custo-benefício baixo - evitar se possível';
  }

  private generateRecommendations(
    routing: RoutingDecision,
    costEstimate: TokenCostEstimate,
    options: RoutingOptions
  ): string[] {
    const recommendations: string[] = [];

    if (routing.route === 'remote' && costEstimate.totalCost > 0.001) {
      recommendations.push('Considere ativar cache para reduzir custos futuros');
    }

    if (routing.compression && routing.compression.compressionRatio < 0.8) {
      recommendations.push(`Compressão aplicada: ${(100 - routing.compression.compressionRatio * 100).toFixed(0)}% de redução de tokens`);
    }

    if (routing.route === 'local') {
      recommendations.push('Modelo local em uso - economia máxima de custos');
    }

    if (routing.confidence < 0.7) {
      recommendations.push('Decisão de roteamento com baixa confiança - monitore resultados');
    }

    if (routing.alternatives.length > 0 && routing.alternatives[0].cost < costEstimate.totalCost * 0.8) {
      recommendations.push(`Alternativa mais barata disponível: ${routing.alternatives[0].model}`);
    }

    return recommendations;
  }
}