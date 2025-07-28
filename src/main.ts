#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import OpenAI from 'openai';
import 'dotenv/config';

// Core imports
import { CacheEngine } from './core/CacheEngine.js';
import { ModelOptimizer } from './services/ModelOptimizer.js';
import { TemplateEngine } from './templates/TemplateEngine.js';
import { MetricsCollector } from './analytics/MetricsCollector.js';
import { LLMProviderFactory } from './providers/LLMProviderFactory.js';
import { MCPHandlers } from './handlers/MCPHandlers.js';
import { DashboardService } from './analytics/DashboardService.js';
import { Logger } from './utils/Logger.js';
import { MCPServerConfig } from './types/index.js';

/**
 * Advanced MCP Token Saver Server with Clean Architecture
 */
class TokenSaverServer {
  private server!: Server;
  private cacheEngine!: CacheEngine;
  private modelOptimizer!: ModelOptimizer;
  private templateEngine!: TemplateEngine;
  private metricsCollector!: MetricsCollector;
  private providerFactory!: LLMProviderFactory;
  private handlers!: MCPHandlers;
  private dashboardService!: DashboardService;
  private logger: Logger;
  private openai!: OpenAI;
  private config!: MCPServerConfig;

  constructor() {
    this.logger = new Logger('TokenSaverServer');
    this.config = this.loadConfiguration();
    this.initializeComponents();
    this.setupServer();
    this.scheduleOptimizations();
  }

  private loadConfiguration(): MCPServerConfig {
    return {
      name: 'advanced-token-saver',
      version: '2.0.0',
      cache: {
        redisUrl: process.env.REDIS_URL,
        dataDir: process.env.CACHE_DATA_DIR || './data',
        maxMemoryMB: parseInt(process.env.CACHE_MAX_MEMORY_MB || '100'),
        defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '3600'),
        enableHeuristics: process.env.CACHE_ENABLE_HEURISTICS !== 'false'
      },
      models: {
        primary: process.env.PRIMARY_MODEL || 'moonshot-v1-8k',
        fallback: process.env.FALLBACK_MODEL || 'moonshot-v1-32k',
        optimization: process.env.MODEL_OPTIMIZATION !== 'false'
      },
      analytics: {
        enabled: process.env.ANALYTICS_ENABLED !== 'false',
        metricsInterval: parseInt(process.env.METRICS_INTERVAL || '300000') // 5 minutes
      }
    };
  }

  private initializeComponents(): void {
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: 'https://api.moonshot.ai/v1'
    });

    // Initialize core components
    this.cacheEngine = new CacheEngine(this.config.cache);
    this.modelOptimizer = new ModelOptimizer();
    this.templateEngine = new TemplateEngine();
    this.metricsCollector = new MetricsCollector();
    this.providerFactory = new LLMProviderFactory();

    // Initialize dashboard service
    this.dashboardService = new DashboardService(
      this.metricsCollector,
      this.cacheEngine,
      this.modelOptimizer,
      this.providerFactory
    );

    // Initialize handlers
    this.handlers = new MCPHandlers(
      this.cacheEngine,
      this.modelOptimizer,
      this.templateEngine,
      this.metricsCollector,
      this.providerFactory,
      this.openai
    );

    // Preload cache patterns
    this.cacheEngine.preloadCommonPatterns().catch(this.logger.error);

    this.logger.info('All components initialized successfully');
  }

  private setupServer(): void {
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.logger.info('MCP Server configured');
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Core functionality
        {
          name: 'smart_moonshot_chat',
          description: 'Advanced chat with intelligent caching, model optimization, and analytics',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'User prompt' },
              context: { type: 'string', description: 'System context' },
              force_cache: { type: 'boolean', description: 'Force cache usage' },
              model: { type: 'string', default: 'moonshot-v1-8k', description: 'Model to use' }
            },
            required: ['prompt']
          }
        },

        // Template system
        {
          name: 'render_template',
          description: 'Render a prompt template with variables for consistent, reusable prompts',
          inputSchema: {
            type: 'object',
            properties: {
              template_id: { type: 'string', description: 'Template ID' },
              variables: { type: 'object', description: 'Template variables' }
            },
            required: ['template_id', 'variables']
          }
        },
        {
          name: 'search_templates',
          description: 'Search available templates by query or category',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              category: { type: 'string', description: 'Template category' }
            }
          }
        },
        {
          name: 'get_template_stats',
          description: 'Get comprehensive template usage statistics and recommendations',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },

        // Analytics and metrics
        {
          name: 'get_advanced_metrics',
          description: 'Get comprehensive metrics with performance analysis and recommendations',
          inputSchema: {
            type: 'object',
            properties: {
              include_performance: { type: 'boolean', default: false, description: 'Include performance metrics' }
            }
          }
        },
        {
          name: 'get_dashboard_data',
          description: 'Get real-time dashboard data for monitoring',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_realtime_dashboard',
          description: 'Get comprehensive real-time dashboard with insights, recommendations and alerts',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'get_historical_trends',
          description: 'Get historical performance trends and analytics',
          inputSchema: {
            type: 'object',
            properties: {
              timeframe: { type: 'string', enum: ['1h', '24h', '7d', '30d'], default: '24h', description: 'Time range for trends' }
            }
          }
        },
        {
          name: 'export_analytics',
          description: 'Export comprehensive analytics data for external analysis',
          inputSchema: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['json', 'csv'], default: 'json', description: 'Export format' }
            }
          }
        },

        // Provider management
        {
          name: 'compare_providers',
          description: 'Compare LLM providers and models for cost optimization',
          inputSchema: {
            type: 'object',
            properties: {
              models: { type: 'array', items: { type: 'string' }, description: 'Models to compare' },
              task_type: { type: 'string', description: 'Type of task' },
              budget: { type: 'number', description: 'Budget constraint' }
            }
          }
        },
        {
          name: 'get_cost_analysis',
          description: 'Get detailed cost analysis for different usage patterns',
          inputSchema: {
            type: 'object',
            properties: {
              tokens_per_month: { type: 'number', description: 'Expected monthly token usage' },
              input_output_ratio: { type: 'number', default: 0.7, description: 'Input to output token ratio' }
            },
            required: ['tokens_per_month']
          }
        },

        // Legacy compatibility
        {
          name: 'get_savings_stats',
          description: 'Get basic savings statistics (legacy compatibility)',
          inputSchema: {
            type: 'object',
            properties: {
              detailed: { type: 'boolean', default: false }
            }
          }
        },
        {
          name: 'cache_cleanup',
          description: 'Execute intelligent cache cleanup',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'optimize_model_selection',
          description: 'Optimize model selection for cache miss scenarios',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'User prompt' },
              context: { type: 'string', description: 'Context' },
              task_type: { type: 'string', description: 'Task type' },
              current_model: { type: 'string', description: 'Current model' }
            },
            required: ['prompt']
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'smart_moonshot_chat':
            return await this.handlers.handleSmartMoonshotChat(args);

          case 'render_template':
            return await this.handlers.handleRenderTemplate(args);

          case 'search_templates':
            return await this.handlers.handleSearchTemplates(args);

          case 'get_template_stats':
            return await this.handlers.handleGetTemplateStats(args);

          case 'get_advanced_metrics':
            return await this.handlers.handleGetAdvancedMetrics(args);

          case 'get_dashboard_data':
            return this.handleGetDashboardData();

          case 'get_realtime_dashboard':
            return await this.handleGetRealtimeDashboard();

          case 'get_historical_trends':
            return await this.handleGetHistoricalTrends(args);

          case 'export_analytics':
            return await this.handleExportAnalytics(args);

          case 'compare_providers':
            return await this.handlers.handleProviderComparison(args);

          case 'get_cost_analysis':
            return this.handleGetCostAnalysis(args);

          // Legacy handlers for backward compatibility
          case 'get_savings_stats':
            return await this.handlers.handleGetAdvancedMetrics({ include_performance: args?.detailed });

          case 'cache_cleanup':
            return this.handleCacheCleanup();

          case 'optimize_model_selection':
            return this.handleOptimizeModelSelection(args);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} not found`);
        }
      } catch (error) {
        this.logger.error('Tool execution failed', { tool: name, error });
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
      }
    });
  }

  // Legacy compatibility handlers
  private handleGetDashboardData() {
    const dashboard = this.metricsCollector.getDashboardData();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dashboard_data: dashboard,
          server_info: {
            name: this.config.name,
            version: this.config.version,
            uptime_minutes: Math.floor((Date.now() - Date.now()) / 60000),
            configuration: {
              cache_enabled: this.config.cache.enableHeuristics,
              analytics_enabled: this.config.analytics.enabled,
              primary_model: this.config.models.primary
            }
          }
        }, null, 2)
      }]
    };
  }

  private handleGetCostAnalysis(args: any) {
    const { tokens_per_month, input_output_ratio = 0.7 } = args;
    
    const analysis = this.providerFactory.getCostAnalysis(tokens_per_month, input_output_ratio);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          cost_analysis: analysis,
          summary: {
            cheapest_option: analysis[0],
            most_expensive: analysis[analysis.length - 1],
            moonshot_ranking: analysis.findIndex(a => a.provider === 'moonshot') + 1,
            savings_vs_openai: analysis.find(a => a.provider === 'openai') ? 
              `${((analysis.find(a => a.provider === 'openai')!.monthly_cost - analysis[0].monthly_cost) / analysis.find(a => a.provider === 'openai')!.monthly_cost * 100).toFixed(1)}%` : 
              'N/A'
          }
        }, null, 2)
      }]
    };
  }

  private async handleCacheCleanup() {
    const result = await this.cacheEngine.cleanup();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          cleanup_completed: true,
          entries_removed: result.removed,
          space_freed_mb: result.freed_mb.toFixed(2),
          timestamp: new Date().toISOString()
        }, null, 2)
      }]
    };
  }

  private handleOptimizeModelSelection(args: any) {
    const { prompt, context, task_type, current_model } = args;
    
    const promptTokens = Math.ceil(prompt.length / 4.5);
    const contextTokens = context ? Math.ceil(context.length / 4.5) : 0;
    const detectedTaskType = task_type || this.detectTaskType(prompt, context);
    
    const optimization = this.modelOptimizer.optimizeModelSelection(
      detectedTaskType,
      promptTokens,
      contextTokens,
      'balanced'
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          model_optimization: true,
          current_model: current_model || 'not_specified',
          recommended_model: optimization.model,
          reason: optimization.reason,
          expected_savings_percent: optimization.expectedSavings.toFixed(1),
          detected_task_type: detectedTaskType,
          optimization_details: optimization
        }, null, 2)
      }]
    };
  }

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

  // New dashboard handlers
  private async handleGetRealtimeDashboard() {
    const dashboard = await this.dashboardService.getRealTimeDashboard();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          realtime_dashboard: dashboard,
          generated_at: new Date().toISOString(),
          server_info: {
            name: this.config.name,
            version: this.config.version,
            uptime: Math.floor((Date.now() - Date.now()) / 60000) + ' minutes'
          }
        }, null, 2)
      }]
    };
  }

  private async handleGetHistoricalTrends(args: any) {
    const { timeframe = '24h' } = args;
    const trends = await this.dashboardService.getHistoricalTrends(timeframe);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          historical_trends: trends,
          timeframe,
          generated_at: new Date().toISOString(),
          data_points: Object.values(trends)[0]?.length || 0
        }, null, 2)
      }]
    };
  }

  private async handleExportAnalytics(args: any) {
    const { format = 'json' } = args;
    const exportData = await this.dashboardService.exportDashboardData(format);
    
    return {
      content: [{
        type: 'text',
        text: format === 'json' ? exportData : JSON.stringify({
          export_completed: true,
          format,
          size_bytes: exportData.length,
          data: exportData
        }, null, 2)
      }]
    };
  }

  private scheduleOptimizations(): void {
    // Auto-optimization every 30 minutes
    setInterval(async () => {
      try {
        await this.cacheEngine.cleanup();
        this.logger.info('Scheduled optimization completed');
      } catch (error) {
        this.logger.error('Scheduled optimization failed', error);
      }
    }, 30 * 60 * 1000);

    // Metrics collection
    if (this.config.analytics.enabled) {
      setInterval(() => {
        const dashboard = this.metricsCollector.getDashboardData();
        this.logger.info('Metrics collected', dashboard.overview);
      }, this.config.analytics.metricsInterval);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    this.logger.info('Advanced Token Saver MCP Server started', {
      version: this.config.version,
      cache_enabled: this.config.cache.enableHeuristics,
      analytics_enabled: this.config.analytics.enabled
    });
  }

  async stop(): Promise<void> {
    await this.cacheEngine.close();
    this.logger.info('Server stopped gracefully');
  }
}

// Main execution
async function main() {
  const server = new TokenSaverServer();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});