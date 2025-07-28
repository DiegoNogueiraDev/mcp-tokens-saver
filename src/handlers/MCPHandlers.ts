import { MCPResponse } from '../types/index.js';
import { CacheEngine } from '../core/CacheEngine.js';
import { ModelOptimizer } from '../services/ModelOptimizer.js';
import { TemplateEngine } from '../templates/TemplateEngine.js';
import { MetricsCollector } from '../analytics/MetricsCollector.js';
import { LLMProviderFactory } from '../providers/LLMProviderFactory.js';
import { Logger } from '../utils/Logger.js';
import OpenAI from 'openai';

/**
 * Centralized MCP request handlers
 */
export class MCPHandlers {
  private cacheEngine: CacheEngine;
  private modelOptimizer: ModelOptimizer;
  private templateEngine: TemplateEngine;
  private metricsCollector: MetricsCollector;
  private providerFactory: LLMProviderFactory;
  private logger: Logger;
  private openai: OpenAI;

  constructor(
    cacheEngine: CacheEngine,
    modelOptimizer: ModelOptimizer,
    templateEngine: TemplateEngine,
    metricsCollector: MetricsCollector,
    providerFactory: LLMProviderFactory,
    openai: OpenAI
  ) {
    this.cacheEngine = cacheEngine;
    this.modelOptimizer = modelOptimizer;
    this.templateEngine = templateEngine;
    this.metricsCollector = metricsCollector;
    this.providerFactory = providerFactory;
    this.openai = openai;
    this.logger = new Logger('MCPHandlers');
  }

  /**
   * Smart chat with intelligent caching and model optimization
   */
  async handleSmartMoonshotChat(args: any): Promise<MCPResponse> {
    const startTime = Date.now();
    const { prompt, context, force_cache, model = 'moonshot-v1-8k' } = args;
    
    try {
      // Check cache first
      const cached = await this.cacheEngine.get(prompt, context, model);
      
      if (cached && !force_cache) {
        this.metricsCollector.recordRequest(true, cached.tokens);
        this.metricsCollector.recordPerformanceData('cache_get', Date.now() - startTime, true);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              response: cached.value,
              cached: true,
              tokens_saved: cached.tokens,
              cache_hits: cached.hits,
              source: 'smart_cache',
              performance: {
                response_time_ms: Date.now() - startTime,
                cache_efficiency: 'high'
              }
            }, null, 2)
          }]
        };
      }

      // Cache miss - optimize model selection
      const optimization = this.modelOptimizer.optimizeModelSelection(
        this.detectTaskType(prompt, context),
        this.estimateTokens(prompt),
        context ? this.estimateTokens(context) : 0,
        'balanced'
      );

      this.metricsCollector.recordModelOptimization(optimization.expectedSavings);

      // Make API request
      const response = await this.openai.chat.completions.create({
        model: optimization.model,
        messages: [
          ...(context ? [{ role: 'system' as const, content: context }] : []),
          { role: 'user' as const, content: prompt }
        ]
      });

      const tokens = response.usage?.total_tokens || 0;
      const responseContent = response.choices[0].message.content || '';

      // Cache the response
      const cacheResult = await this.cacheEngine.set(prompt, responseContent, {
        context,
        model: optimization.model,
        tokens,
        tags: this.extractTags(prompt, context),
        forceCache: force_cache
      });

      this.metricsCollector.recordRequest(false);
      this.metricsCollector.recordCachingDecision(cacheResult.cached);
      this.metricsCollector.recordPerformanceData('api_request', Date.now() - startTime, true);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            response: responseContent,
            tokens_used: tokens,
            cached: false,
            cache_decision: cacheResult,
            model_optimization: {
              recommended_model: optimization.model,
              reason: optimization.reason,
              expected_savings: optimization.expectedSavings
            },
            performance: {
              response_time_ms: Date.now() - startTime,
              optimized: true
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      this.logger.error('Smart chat failed', error);
      this.metricsCollector.recordPerformanceData('api_request', Date.now() - startTime, false);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Request failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            performance: {
              response_time_ms: Date.now() - startTime,
              success: false
            }
          }, null, 2)
        }]
      };
    }
  }

  /**
   * Template management handlers
   */
  async handleRenderTemplate(args: any): Promise<MCPResponse> {
    const { template_id, variables } = args;
    
    try {
      const result = this.templateEngine.render(template_id, variables);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            rendered_prompt: result.rendered,
            estimated_tokens: result.estimated_tokens,
            template: result.template,
            recommended_model: result.template.recommended_model,
            cache_eligible: result.template.cache_eligible,
            optimization_tips: {
              tokens_estimated: result.estimated_tokens,
              caching_recommended: result.template.cache_eligible,
              model_recommendation: result.template.recommended_model
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Template rendering failed',
            message: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }]
      };
    }
  }

  async handleSearchTemplates(args: any): Promise<MCPResponse> {
    const { query, category } = args;
    
    const templates = category ? 
      this.templateEngine.getTemplatesByCategory(category) :
      this.templateEngine.searchTemplates(query || '');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          templates: templates.map(t => ({
            id: t.id,
            name: t.name,
            category: t.category,
            variables: t.variables,
            estimated_tokens: t.estimated_tokens,
            cache_eligible: t.cache_eligible,
            recommended_model: t.recommended_model
          })),
          total_found: templates.length,
          search_criteria: { query, category }
        }, null, 2)
      }]
    };
  }

  async handleGetTemplateStats(args: any): Promise<MCPResponse> {
    const stats = this.templateEngine.getTemplateStats();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          template_statistics: stats,
          recommendations: {
            most_efficient_category: Object.entries(stats.by_category)
              .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none',
            cache_utilization: `${((stats.cache_eligible / stats.total) * 100).toFixed(1)}%`,
            avg_efficiency: stats.avg_tokens < 100 ? 'High' : 
                           stats.avg_tokens < 200 ? 'Medium' : 'Low'
          }
        }, null, 2)
      }]
    };
  }

  /**
   * Advanced analytics handlers
   */
  async handleGetAdvancedMetrics(args: any): Promise<MCPResponse> {
    const { include_performance = false } = args;
    
    const report = this.metricsCollector.getMetricsReport();
    const dashboard = this.metricsCollector.getDashboardData();
    
    let performance = {};
    if (include_performance) {
      performance = this.metricsCollector.getPerformanceMetrics();
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          advanced_metrics: true,
          report,
          dashboard,
          performance: include_performance ? performance : undefined,
          insights: {
            efficiency_rating: this.calculateEfficiencyRating(report.efficiency),
            cost_optimization_status: this.getCostOptimizationStatus(report),
            recommendations: dashboard.recommendations
          }
        }, null, 2)
      }]
    };
  }

  async handleProviderComparison(args: any): Promise<MCPResponse> {
    const { models = [], task_type, budget } = args;
    
    const comparison = this.providerFactory.compareModels(models);
    const costEffective = this.providerFactory.findCostEffectiveModel(
      task_type || 'general',
      budget
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          provider_comparison: comparison,
          cost_effective_recommendation: costEffective ? {
            model: costEffective.name,
            cost_per_1m: `$${((costEffective.inputCostPer1M * 0.7) + (costEffective.outputCostPer1M * 0.3)).toFixed(2)}`,
            performance: costEffective.performance,
            recommended_for: costEffective.recommended
          } : null,
          analysis: {
            total_models_compared: comparison.comparison.length,
            price_range: {
              cheapest: comparison.cheapest,
              highest_performance: comparison.highest_performance,
              best_value: comparison.best_value
            }
          }
        }, null, 2)
      }]
    };
  }

  /**
   * Utility methods
   */
  private detectTaskType(prompt: string, context?: string): string {
    const content = `${prompt} ${context || ''}`.toLowerCase();

    if (/code|function|class|debug|review|program/i.test(content)) {
      return 'coding';
    }
    
    if (/analys|explain|understand|describe|interpret/i.test(content)) {
      return 'analysis';
    }
    
    if (/document|write|generate|create|compose/i.test(content)) {
      return 'documentation';
    }
    
    if (content.length > 2000 || /long|large|document|report/i.test(content)) {
      return 'long-context';
    }

    return 'general';
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4.5);
  }

  private extractTags(prompt: string, context?: string): string[] {
    const content = `${prompt} ${context || ''}`.toLowerCase();
    const tags: string[] = [];
    
    const techPatterns = {
      'javascript': /javascript|js\b/,
      'typescript': /typescript|ts\b/,
      'react': /react/,
      'nodejs': /node\.?js|npm/,
      'python': /python|py\b/,
      'sql': /sql|database|db\b/,
      'api': /api|endpoint|rest/,
      'frontend': /frontend|ui|interface/,
      'backend': /backend|server/
    };
    
    const taskPatterns = {
      'code-review': /review|audit|check/,
      'debugging': /debug|error|bug|fix/,
      'optimization': /optimize|improve|refactor/,
      'documentation': /document|comment|explain/,
      'analysis': /analys|inspect|examine/,
      'generation': /generate|create|build/
    };
    
    const allPatterns = { ...techPatterns, ...taskPatterns };
    
    for (const [tag, pattern] of Object.entries(allPatterns)) {
      if (pattern.test(content)) {
        tags.push(tag);
      }
    }
    
    return tags;
  }

  private calculateEfficiencyRating(efficiency: any): string {
    const score = (
      efficiency.cache_hit_rate * 0.4 +
      efficiency.decision_accuracy * 0.3 +
      (efficiency.estimated_cost_savings * 10000) * 0.3
    );

    if (score > 70) return 'Excellent';
    if (score > 50) return 'Good';
    if (score > 30) return 'Fair';
    return 'Needs Improvement';
  }

  private getCostOptimizationStatus(report: any): string {
    const savings = report.efficiency.estimated_cost_savings;
    
    if (savings > 0.01) return 'Highly Optimized';
    if (savings > 0.005) return 'Well Optimized';
    if (savings > 0.001) return 'Moderately Optimized';
    return 'Optimization Needed';
  }
}