import { UsageMetrics, EfficiencyMetrics } from '../types/index.js';
import { Logger } from '../utils/Logger.js';

/**
 * Advanced metrics collection and analysis system
 */
export class MetricsCollector {
  private metrics: UsageMetrics;
  private logger: Logger;
  private startTime: number;
  private sessionMetrics: Map<string, any> = new Map();

  constructor() {
    this.metrics = {
      requests: 0,
      hits: 0,
      misses: 0,
      tokens_saved: 0,
      decisions_made: 0,
      correct_decisions: 0,
      model_optimizations: 0,
      cost_savings: 0
    };
    
    this.logger = new Logger('MetricsCollector');
    this.startTime = Date.now();
  }

  /**
   * Records a cache request
   */
  recordRequest(hit: boolean, tokensSaved: number = 0): void {
    this.metrics.requests++;
    
    if (hit) {
      this.metrics.hits++;
      this.metrics.tokens_saved += tokensSaved;
    } else {
      this.metrics.misses++;
    }
  }

  /**
   * Records a caching decision
   */
  recordCachingDecision(decided: boolean, correct?: boolean): void {
    this.metrics.decisions_made++;
    
    if (correct !== undefined) {
      if (correct) {
        this.metrics.correct_decisions++;
      }
    }
  }

  /**
   * Records model optimization
   */
  recordModelOptimization(costSavings: number): void {
    this.metrics.model_optimizations++;
    this.metrics.cost_savings += costSavings;
  }

  /**
   * Calculates efficiency metrics
   */
  getEfficiencyMetrics(): EfficiencyMetrics {
    return {
      cache_hit_rate: this.metrics.requests > 0 ? 
        (this.metrics.hits / this.metrics.requests) * 100 : 0,
      decision_accuracy: this.metrics.decisions_made > 0 ? 
        (this.metrics.correct_decisions / this.metrics.decisions_made) * 100 : 0,
      avg_tokens_per_hit: this.metrics.hits > 0 ? 
        this.metrics.tokens_saved / this.metrics.hits : 0,
      estimated_cost_savings: this.metrics.tokens_saved * 0.000002 + this.metrics.cost_savings
    };
  }

  /**
   * Gets comprehensive metrics report
   */
  getMetricsReport(): {
    usage: UsageMetrics;
    efficiency: EfficiencyMetrics;
    session: {
      duration_minutes: number;
      requests_per_minute: number;
      tokens_per_minute: number;
    };
    trends: {
      hit_rate_trend: string;
      optimization_rate: string;
      cost_efficiency: string;
    };
  } {
    const efficiency = this.getEfficiencyMetrics();
    const durationMinutes = (Date.now() - this.startTime) / 60000;

    return {
      usage: { ...this.metrics },
      efficiency,
      session: {
        duration_minutes: Math.round(durationMinutes * 100) / 100,
        requests_per_minute: durationMinutes > 0 ? 
          Math.round((this.metrics.requests / durationMinutes) * 100) / 100 : 0,
        tokens_per_minute: durationMinutes > 0 ? 
          Math.round((this.metrics.tokens_saved / durationMinutes) * 100) / 100 : 0
      },
      trends: this.analyzeTrends(efficiency)
    };
  }

  private analyzeTrends(efficiency: EfficiencyMetrics): {
    hit_rate_trend: string;
    optimization_rate: string;
    cost_efficiency: string;
  } {
    const hitRate = efficiency.cache_hit_rate;
    const optimizationRate = this.metrics.requests > 0 ? 
      (this.metrics.model_optimizations / this.metrics.requests) * 100 : 0;
    const costEfficiency = efficiency.estimated_cost_savings;

    return {
      hit_rate_trend: hitRate > 50 ? 'Excellent' : 
                     hitRate > 30 ? 'Good' : 
                     hitRate > 15 ? 'Fair' : 'Poor',
      optimization_rate: optimizationRate > 80 ? 'High' : 
                        optimizationRate > 50 ? 'Medium' : 'Low',
      cost_efficiency: costEfficiency > 0.01 ? 'High' : 
                      costEfficiency > 0.005 ? 'Medium' : 'Low'
    };
  }

  /**
   * Records performance data for analysis
   */
  recordPerformanceData(operation: string, duration: number, success: boolean): void {
    const key = `perf_${operation}`;
    
    if (!this.sessionMetrics.has(key)) {
      this.sessionMetrics.set(key, {
        total_calls: 0,
        total_duration: 0,
        success_count: 0,
        avg_duration: 0
      });
    }

    const perfData = this.sessionMetrics.get(key);
    perfData.total_calls++;
    perfData.total_duration += duration;
    if (success) perfData.success_count++;
    perfData.avg_duration = perfData.total_duration / perfData.total_calls;

    this.sessionMetrics.set(key, perfData);
  }

  /**
   * Gets performance metrics
   */
  getPerformanceMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    for (const [key, value] of this.sessionMetrics.entries()) {
      if (key.startsWith('perf_')) {
        const operation = key.replace('perf_', '');
        metrics[operation] = {
          ...value,
          success_rate: value.total_calls > 0 ? 
            (value.success_count / value.total_calls) * 100 : 0
        };
      }
    }

    return metrics;
  }

  /**
   * Exports metrics to JSON for external analysis
   */
  exportMetrics(): string {
    return JSON.stringify({
      report: this.getMetricsReport(),
      performance: this.getPerformanceMetrics(),
      raw_metrics: this.metrics,
      export_timestamp: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Resets metrics (useful for testing or fresh starts)
   */
  reset(): void {
    this.metrics = {
      requests: 0,
      hits: 0,
      misses: 0,
      tokens_saved: 0,
      decisions_made: 0,
      correct_decisions: 0,
      model_optimizations: 0,
      cost_savings: 0
    };
    
    this.sessionMetrics.clear();
    this.startTime = Date.now();
    this.logger.info('Metrics reset');
  }

  /**
   * Gets real-time dashboard data
   */
  getDashboardData(): {
    overview: {
      total_requests: number;
      hit_rate: string;
      tokens_saved: number;
      cost_savings: string;
    };
    performance: {
      avg_response_time?: number;
      success_rate?: number;
      cache_operations?: number;
    };
    recommendations: string[];
  } {
    const efficiency = this.getEfficiencyMetrics();
    const performance = this.getPerformanceMetrics();
    
    const recommendations: string[] = [];
    
    if (efficiency.cache_hit_rate < 20) {
      recommendations.push('Consider relaxing cache heuristics');
    }
    
    if (this.metrics.model_optimizations < this.metrics.requests * 0.5) {
      recommendations.push('Enable more aggressive model optimization');
    }
    
    if (efficiency.estimated_cost_savings < 0.001) {
      recommendations.push('Review pricing models and cache strategies');
    }

    return {
      overview: {
        total_requests: this.metrics.requests,
        hit_rate: `${efficiency.cache_hit_rate.toFixed(1)}%`,
        tokens_saved: this.metrics.tokens_saved,
        cost_savings: `$${efficiency.estimated_cost_savings.toFixed(4)}`
      },
      performance: {
        avg_response_time: performance.cache_get?.avg_duration,
        success_rate: performance.cache_get?.success_rate,
        cache_operations: this.metrics.hits + this.metrics.misses
      },
      recommendations
    };
  }

  /**
   * Records custom metric
   */
  recordCustomMetric(name: string, value: number | string | boolean): void {
    this.sessionMetrics.set(`custom_${name}`, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Gets all custom metrics
   */
  getCustomMetrics(): Record<string, any> {
    const customs: Record<string, any> = {};
    
    for (const [key, value] of this.sessionMetrics.entries()) {
      if (key.startsWith('custom_')) {
        const metricName = key.replace('custom_', '');
        customs[metricName] = value;
      }
    }

    return customs;
  }
}