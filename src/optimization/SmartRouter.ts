/**
 * Smart Router - Implementa roteamento inteligente baseado no LiteLLM Gateway
 * Decide entre modelo local, cache ou API remota baseado em custo-benefício
 */

import { TokenCostIntegration, TokenCostEstimate } from './TokenCostIntegration.js';
import { ContextCompression, CompressionResult } from './ContextCompression.js';

export interface RoutingDecision {
  route: 'cache' | 'local' | 'remote';
  model: string;
  reason: string;
  estimatedCost: number;
  estimatedLatency: number;
  confidence: number; // 0-1
  alternatives: Array<{
    route: 'cache' | 'local' | 'remote';
    model: string;
    cost: number;
    latency: number;
    reason: string;
  }>;
  compression?: CompressionResult;
}

export interface RoutingOptions {
  maxBudget?: number;
  maxLatency?: number;
  qualityLevel?: 'fast' | 'balanced' | 'premium';
  taskType?: 'coding' | 'analysis' | 'documentation' | 'long-context' | 'general';
  preferLocal?: boolean;
  allowCompression?: boolean;
}

export interface CacheInfo {
  hitProbability: number;
  averageLatency: number;
  costPerHit: number;
}

export interface LocalModelInfo {
  available: boolean;
  model: string;
  averageLatency: number;
  qualityScore: number; // 0-1 vs premium models
}

export class SmartRouter {
  private cacheInfo: CacheInfo;
  private localModelInfo: LocalModelInfo;

  constructor(
    cacheInfo: CacheInfo = {
      hitProbability: 0.3,
      averageLatency: 50,
      costPerHit: 0.0001
    },
    localModelInfo: LocalModelInfo = {
      available: false,
      model: 'local-llama-3.2-3b',
      averageLatency: 2000,
      qualityScore: 0.7
    }
  ) {
    this.cacheInfo = cacheInfo;
    this.localModelInfo = localModelInfo;
  }

  /**
   * Roteamento principal - decide a melhor estratégia
   */
  route(
    prompt: string,
    context: string = '',
    options: RoutingOptions = {}
  ): RoutingDecision {
    const {
      maxBudget = 0.01, // $0.01 default
      maxLatency = 5000, // 5s default
      qualityLevel = 'balanced',
      taskType = 'general',
      preferLocal = false,
      allowCompression = true
    } = options;

    const fullText = `${context}\n${prompt}`.trim();
    const inputTokens = this.estimateTokens(fullText);
    const estimatedOutputTokens = this.estimateOutputTokens(prompt, taskType);

    // Avalia todas as rotas possíveis
    const routes = this.evaluateAllRoutes(
      fullText,
      inputTokens,
      estimatedOutputTokens,
      options
    );

    // Aplica filtros e critérios de seleção
    let viableRoutes = routes.filter(route => 
      route.cost <= maxBudget && route.latency <= maxLatency
    );

    // Se nenhuma rota viável, relaxa restrições
    if (viableRoutes.length === 0) {
      viableRoutes = routes.filter(route => route.cost <= maxBudget * 2);
      if (viableRoutes.length === 0) {
        viableRoutes = [routes[0]]; // Pega a mais barata
      }
    }

    // Seleciona melhor rota baseada no nível de qualidade
    const selectedRoute = this.selectBestRoute(viableRoutes, qualityLevel, preferLocal);
    
    // Verifica se compressão pode ajudar
    let compression: CompressionResult | undefined;
    if (allowCompression && selectedRoute.route === 'remote' && inputTokens > 1000) {
      const targetTokens = Math.floor(inputTokens * 0.7); // Comprime 30%
      compression = ContextCompression.smartCompress(fullText, targetTokens, {
        contextType: this.mapTaskTypeToContext(taskType),
        aggressiveness: qualityLevel === 'fast' ? 'aggressive' : 'moderate'
      });

      // Recalcula custo com texto comprimido
      if (compression.compressionRatio < 0.9) {
        const newEstimate = TokenCostIntegration.estimateCost(
          selectedRoute.model,
          compression.compressedTokens,
          estimatedOutputTokens
        );
        selectedRoute.cost = newEstimate.totalCost;
      }
    }

    return {
      route: selectedRoute.route,
      model: selectedRoute.model,
      reason: selectedRoute.reason,
      estimatedCost: selectedRoute.cost,
      estimatedLatency: selectedRoute.latency,
      confidence: this.calculateConfidence(selectedRoute, viableRoutes),
      alternatives: routes
        .filter(r => r !== selectedRoute)
        .slice(0, 3) // Top 3 alternatives
        .map(r => ({
          route: r.route,
          model: r.model,
          cost: r.cost,
          latency: r.latency,
          reason: r.reason
        })),
      compression
    };
  }

  /**
   * Avalia todas as rotas possíveis
   */
  private evaluateAllRoutes(
    fullText: string,
    inputTokens: number,
    estimatedOutputTokens: number,
    options: RoutingOptions
  ): Array<{
    route: 'cache' | 'local' | 'remote';
    model: string;
    cost: number;
    latency: number;
    quality: number;
    reason: string;
  }> {
    const routes: Array<{
      route: 'cache' | 'local' | 'remote';
      model: string;
      cost: number;
      latency: number;
      quality: number;
      reason: string;
    }> = [];

    // Rota: Cache
    const expectedCacheCost = this.cacheInfo.costPerHit + 
      (1 - this.cacheInfo.hitProbability) * this.getRemoteCost(inputTokens, estimatedOutputTokens);
    
    routes.push({
      route: 'cache',
      model: 'cache-first',
      cost: expectedCacheCost,
      latency: this.cacheInfo.averageLatency + 
        (1 - this.cacheInfo.hitProbability) * this.getRemoteLatency(),
      quality: 1.0, // Cache retorna resultado original
      reason: `Cache hit probability: ${(this.cacheInfo.hitProbability * 100).toFixed(0)}%`
    });

    // Rota: Local (se disponível)
    if (this.localModelInfo.available) {
      routes.push({
        route: 'local',
        model: this.localModelInfo.model,
        cost: 0.001, // Custo computacional simbólico
        latency: this.localModelInfo.averageLatency,
        quality: this.localModelInfo.qualityScore,
        reason: 'Local model available, zero API cost'
      });
    }

    // Rotas: Modelos remotos
    const remoteModels = this.getRemoteModelsByTask(options.taskType || 'general');
    for (const model of remoteModels) {
      const estimate = TokenCostIntegration.estimateCost(model, inputTokens, estimatedOutputTokens);
      routes.push({
        route: 'remote',
        model,
        cost: estimate.totalCost,
        latency: this.getRemoteLatency(model),
        quality: this.getModelQuality(model),
        reason: `Direct API call to ${model}`
      });
    }

    return routes.sort((a, b) => a.cost - b.cost);
  }

  /**
   * Seleciona a melhor rota baseada nos critérios
   */
  private selectBestRoute(
    routes: Array<{
      route: 'cache' | 'local' | 'remote';
      model: string;
      cost: number;
      latency: number;
      quality: number;
      reason: string;
    }>,
    qualityLevel: 'fast' | 'balanced' | 'premium',
    preferLocal: boolean
  ) {
    if (routes.length === 0) {
      throw new Error('No viable routes available');
    }

    // Prefer local if requested and available
    if (preferLocal) {
      const localRoute = routes.find(r => r.route === 'local');
      if (localRoute) return localRoute;
    }

    switch (qualityLevel) {
      case 'fast':
        // Prioriza latência baixa e custo baixo
        return routes.sort((a, b) => 
          (a.latency * 0.6 + a.cost * 100 * 0.4) - 
          (b.latency * 0.6 + b.cost * 100 * 0.4)
        )[0];

      case 'premium':
        // Prioriza qualidade, depois custo
        return routes.sort((a, b) => 
          (b.quality * 0.8 - a.cost * 20 * 0.2) - 
          (a.quality * 0.8 - b.cost * 20 * 0.2)
        )[0];

      case 'balanced':
      default:
        // Balanceamento: custo 40%, qualidade 35%, latência 25%
        return routes.sort((a, b) => {
          const scoreA = -a.cost * 40 + a.quality * 35 - a.latency / 100 * 25;
          const scoreB = -b.cost * 40 + b.quality * 35 - b.latency / 100 * 25;
          return scoreB - scoreA;
        })[0];
    }
  }

  /**
   * Calcula confiança na decisão
   */
  private calculateConfidence(
    selected: any,
    allRoutes: any[]
  ): number {
    if (allRoutes.length <= 1) return 1.0;

    // Confiança baseada na diferença para a segunda opção
    const sorted = allRoutes.sort((a, b) => 
      this.getRouteScore(a) - this.getRouteScore(b)
    );

    const bestScore = this.getRouteScore(sorted[0]);
    const secondScore = this.getRouteScore(sorted[1]);
    const diff = Math.abs(bestScore - secondScore);

    // Normaliza diferença para confidence score
    return Math.min(1.0, 0.5 + diff / 10);
  }

  private getRouteScore(route: any): number {
    return -route.cost * 40 + route.quality * 35 - route.latency / 100 * 25;
  }

  /**
   * Estimativa simples de tokens
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4.5);
  }

  /**
   * Estima tokens de output baseado no tipo de tarefa
   */
  private estimateOutputTokens(prompt: string, taskType: string): number {
    const promptTokens = this.estimateTokens(prompt);
    
    const ratios: Record<string, number> = {
      'coding': 2.0, // Código tende a ser verboso
      'analysis': 1.5, // Análises detalhadas
      'documentation': 2.5, // Documentação extensa
      'long-context': 0.3, // Resumos/extrações
      'general': 1.0
    };

    return Math.floor(promptTokens * (ratios[taskType] || 1.0));
  }

  /**
   * Mapeia task type para context type da compressão
   */
  private mapTaskTypeToContext(taskType: string): 'conversation' | 'documentation' | 'code' | 'general' {
    const mapping: Record<string, 'conversation' | 'documentation' | 'code' | 'general'> = {
      'coding': 'code',
      'analysis': 'documentation',
      'documentation': 'documentation',
      'long-context': 'conversation',
      'general': 'general'
    };
    return mapping[taskType] || 'general';
  }

  /**
   * Obtém modelos recomendados por tipo de tarefa
   */
  private getRemoteModelsByTask(taskType: string): string[] {
    const taskModels: Record<string, string[]> = {
      'coding': ['moonshot-v1-8k', 'moonshot-v1-32k'],
      'analysis': ['moonshot-v1-32k', 'moonshot-v1-8k'],
      'documentation': ['moonshot-v1-8k', 'moonshot-v1-32k'],
      'long-context': ['moonshot-v1-128k', 'moonshot-v1-32k'],
      'general': ['moonshot-v1-8k', 'moonshot-v1-32k']
    };

    return taskModels[taskType] || taskModels['general'];
  }

  /**
   * Custo do modelo remoto mais barato
   */
  private getRemoteCost(inputTokens: number, outputTokens: number): number {
    return TokenCostIntegration.estimateCost('moonshot-v1-8k', inputTokens, outputTokens).totalCost;
  }

  /**
   * Latência típica para modelos remotos
   */
  private getRemoteLatency(model?: string): number {
    const latencies: Record<string, number> = {
      'moonshot-v1-8k': 800,
      'moonshot-v1-32k': 1200,
      'moonshot-v1-128k': 2000
    };
    return latencies[model || 'moonshot-v1-8k'] || 1000;
  }

  /**
   * Score de qualidade por modelo
   */
  private getModelQuality(model: string): number {
    const qualities: Record<string, number> = {
      'moonshot-v1-8k': 0.85,
      'moonshot-v1-32k': 0.9,
      'moonshot-v1-128k': 0.95,
      'gpt-4o': 1.0,
      'local-llama-3.2-3b': 0.7
    };
    return qualities[model] || 0.8;
  }

  /**
   * Atualiza informações do cache
   */
  updateCacheInfo(info: Partial<CacheInfo>): void {
    this.cacheInfo = { ...this.cacheInfo, ...info };
  }

  /**
   * Atualiza informações do modelo local
   */
  updateLocalModelInfo(info: Partial<LocalModelInfo>): void {
    this.localModelInfo = { ...this.localModelInfo, ...info };
  }

  /**
   * Análise de economia potencial
   */
  analyzePotentialSavings(
    dailyRequests: number,
    averageInputTokens: number,
    averageOutputTokens: number
  ): {
    baseline: number;
    withCache: number;
    withLocal: number;
    withBoth: number;
    monthlyProjections: {
      baseline: number;
      optimized: number;
      savings: number;
      savingsPercent: number;
    };
  } {
    const dailyBaseline = TokenCostIntegration.estimateCost(
      'moonshot-v1-8k',
      averageInputTokens,
      averageOutputTokens
    ).totalCost * dailyRequests;

    const dailyWithCache = dailyBaseline * (1 - this.cacheInfo.hitProbability * 0.9);
    const dailyWithLocal = this.localModelInfo.available ? 
      dailyBaseline * 0.1 : dailyBaseline; // 90% savings with local
    const dailyWithBoth = this.localModelInfo.available ?
      dailyBaseline * (1 - this.cacheInfo.hitProbability) * 0.1 :
      dailyWithCache;

    const monthlyBaseline = dailyBaseline * 30;
    const monthlyOptimized = dailyWithBoth * 30;
    const monthlySavings = monthlyBaseline - monthlyOptimized;

    return {
      baseline: dailyBaseline,
      withCache: dailyWithCache,
      withLocal: dailyWithLocal,
      withBoth: dailyWithBoth,
      monthlyProjections: {
        baseline: monthlyBaseline,
        optimized: monthlyOptimized,
        savings: monthlySavings,
        savingsPercent: (monthlySavings / monthlyBaseline) * 100
      }
    };
  }
}