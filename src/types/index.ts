// Core Types
export interface CacheEntry {
  id: string;
  key: string;
  value: any;
  tokens: number;
  hits: number;
  created_at: number;
  last_accessed: number;
  expires_at?: number;
  tags?: string[];
  model?: string;
  compressed_size: number;
  original_size: number;
}

export interface CacheStats {
  total_entries: number;
  total_hits: number;
  total_tokens_saved: number;
  cache_size_mb: number;
  hit_rate: number;
  compression_ratio: number;
  top_keys: Array<{key: string, hits: number, tokens_saved: number}>;
}

export interface CacheDecision {
  shouldCache: boolean;
  reason: string;
  estimatedSavings: number;
  ttl: number;
}

// Model Types
export interface ModelPricing {
  name: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  contextWindow: number;
  performance: number;
  cachingSupport: boolean;
  recommended: string[];
}

export interface OptimizationStrategy {
  model: string;
  reason: string;
  expectedSavings: number;
  fallbackModel?: string;
  useCache: boolean;
}

// Configuration Types
export interface SmartCacheOptions {
  redisUrl?: string;
  dataDir?: string;
  maxMemoryMB?: number;
  defaultTTL?: number;
  enableHeuristics?: boolean;
}

export interface MCPServerConfig {
  name: string;
  version: string;
  cache: SmartCacheOptions & {
    enableVectorCache?: boolean;
  };
  models: {
    primary: string;
    fallback: string;
    optimization: boolean;
  };
  analytics: {
    enabled: boolean;
    metricsInterval: number;
  };
  queue?: {
    enabled: boolean;
    maxConcurrency?: number;
    enableRateLimiting?: boolean;
    enableLoadBalancing?: boolean;
    enableCircuitBreaker?: boolean;
    enableAutoScaling?: boolean;
  };
}

// Analytics Types
export interface UsageMetrics {
  requests: number;
  hits: number;
  misses: number;
  tokens_saved: number;
  decisions_made: number;
  correct_decisions: number;
  model_optimizations: number;
  cost_savings: number;
}

export interface EfficiencyMetrics {
  cache_hit_rate: number;
  decision_accuracy: number;
  avg_tokens_per_hit: number;
  estimated_cost_savings: number;
}

// Provider Types
export interface LLMProvider {
  name: string;
  models: ModelPricing[];
  baseURL: string;
  supportsStreaming: boolean;
  supportsCaching: boolean;
}

// Template Types
export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  template: string;
  variables: string[];
  estimated_tokens: number;
  cache_eligible: boolean;
  recommended_model: string;
}

// Task Types
export type TaskType = 'coding' | 'analysis' | 'documentation' | 'long-context' | 'general' | 'debugging' | 'optimization';
export type QualityLevel = 'fast' | 'balanced' | 'premium';

// Response Types
export interface MCPResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

export interface OptimizationResult {
  recommendedModel: string;
  reason: string;
  expectedSavings: number;
  costOptimization: OptimizationStrategy;
}

export interface CacheEfficiencyAnalysis {
  cacheROI: {
    useCache: boolean;
    projectedSavings: number;
    recommendation: string;
  };
  modelRecommendations: string[];
  optimizationStrategy: string;
}