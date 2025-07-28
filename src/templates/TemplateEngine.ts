import { PromptTemplate, TaskType } from '../types/index.js';
import { TokenEstimator } from '../utils/TokenEstimator.js';
import { Logger } from '../utils/Logger.js';

/**
 * Advanced template engine for reusable prompt patterns
 */
export class TemplateEngine {
  private templates: Map<string, PromptTemplate> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('TemplateEngine');
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates() {
    const defaultTemplates: PromptTemplate[] = [
      // Coding Templates
      {
        id: 'code-review',
        name: 'Code Review Template',
        category: 'coding',
        template: 'Review this {{language}} code for best practices, potential bugs, and improvements:\n\n```{{language}}\n{{code}}\n```\n\nFocus on: {{focus_areas}}',
        variables: ['language', 'code', 'focus_areas'],
        estimated_tokens: 150,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-8k'
      },
      {
        id: 'code-explanation',
        name: 'Code Explanation Template',
        category: 'coding',
        template: 'Explain how this {{language}} code works, step by step:\n\n```{{language}}\n{{code}}\n```\n\nTarget audience: {{audience_level}}',
        variables: ['language', 'code', 'audience_level'],
        estimated_tokens: 120,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-8k'
      },
      {
        id: 'debug-helper',
        name: 'Debug Assistant Template',
        category: 'debugging',
        template: 'Help debug this {{language}} code. The issue is: {{problem_description}}\n\n```{{language}}\n{{code}}\n```\n\nError message: {{error_message}}',
        variables: ['language', 'problem_description', 'code', 'error_message'],
        estimated_tokens: 140,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-8k'
      },
      {
        id: 'refactor-suggestion',
        name: 'Refactoring Template',
        category: 'optimization',
        template: 'Suggest refactoring improvements for this {{language}} code to improve {{improvement_goal}}:\n\n```{{language}}\n{{code}}\n```\n\nConstraints: {{constraints}}',
        variables: ['language', 'improvement_goal', 'code', 'constraints'],
        estimated_tokens: 160,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-32k'
      },

      // Analysis Templates
      {
        id: 'document-analysis',
        name: 'Document Analysis Template',
        category: 'analysis',
        template: 'Analyze this {{document_type}} and provide insights on {{analysis_focus}}:\n\n{{document_content}}\n\nSpecific questions:\n{{questions}}',
        variables: ['document_type', 'analysis_focus', 'document_content', 'questions'],
        estimated_tokens: 200,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-128k'
      },
      {
        id: 'comparison-analysis',
        name: 'Comparison Template',
        category: 'analysis',
        template: 'Compare {{item_a}} and {{item_b}} in terms of:\n- {{criteria_1}}\n- {{criteria_2}}\n- {{criteria_3}}\n\nProvide a detailed comparison and recommendation.',
        variables: ['item_a', 'item_b', 'criteria_1', 'criteria_2', 'criteria_3'],
        estimated_tokens: 130,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-32k'
      },

      // Documentation Templates
      {
        id: 'api-documentation',
        name: 'API Documentation Template',
        category: 'documentation',
        template: 'Generate comprehensive API documentation for:\n\nEndpoint: {{endpoint}}\nMethod: {{method}}\nDescription: {{description}}\n\nParameters:\n{{parameters}}\n\nResponse format:\n{{response_format}}',
        variables: ['endpoint', 'method', 'description', 'parameters', 'response_format'],
        estimated_tokens: 180,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-32k'
      },
      {
        id: 'function-documentation',
        name: 'Function Documentation Template',
        category: 'documentation',
        template: 'Create JSDoc documentation for this {{language}} function:\n\n```{{language}}\n{{function_code}}\n```\n\nInclude: description, parameters, returns, examples, and {{additional_sections}}',
        variables: ['language', 'function_code', 'additional_sections'],
        estimated_tokens: 150,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-8k'
      },

      // Learning Templates
      {
        id: 'concept-explanation',
        name: 'Concept Explanation Template',
        category: 'education',
        template: 'Explain the concept of {{concept}} in {{context}}.\n\nTarget audience: {{audience_level}}\nInclude: {{include_elements}}\nAvoid: {{avoid_elements}}',
        variables: ['concept', 'context', 'audience_level', 'include_elements', 'avoid_elements'],
        estimated_tokens: 120,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-8k'
      },
      {
        id: 'step-by-step-guide',
        name: 'Tutorial Template',
        category: 'education',
        template: 'Create a step-by-step guide for {{task}}.\n\nTarget: {{target_audience}}\nFormat: {{format_preference}}\nDifficulty: {{difficulty_level}}\n\nInclude practical examples and common pitfalls.',
        variables: ['task', 'target_audience', 'format_preference', 'difficulty_level'],
        estimated_tokens: 140,
        cache_eligible: true,
        recommended_model: 'moonshot-v1-32k'
      }
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });

    this.logger.info('Initialized default templates', { count: defaultTemplates.length });
  }

  /**
   * Renders a template with provided variables
   */
  render(templateId: string, variables: Record<string, string>): {
    rendered: string;
    estimated_tokens: number;
    template: PromptTemplate;
  } {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Validate required variables
    const missingVars = template.variables.filter(varName => !(varName in variables));
    if (missingVars.length > 0) {
      throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
    }

    // Render template
    let rendered = template.template;
    template.variables.forEach(varName => {
      const placeholder = `{{${varName}}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), variables[varName] || '');
    });

    const estimatedTokens = TokenEstimator.estimateFromText(rendered);

    this.logger.debug('Template rendered', {
      templateId,
      estimatedTokens,
      variables: Object.keys(variables)
    });

    return {
      rendered,
      estimated_tokens: estimatedTokens,
      template
    };
  }

  /**
   * Finds templates by category
   */
  getTemplatesByCategory(category: string): PromptTemplate[] {
    return Array.from(this.templates.values())
      .filter(template => template.category === category);
  }

  /**
   * Searches templates by keywords
   */
  searchTemplates(query: string): PromptTemplate[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.templates.values())
      .filter(template => 
        template.name.toLowerCase().includes(queryLower) ||
        template.category.toLowerCase().includes(queryLower) ||
        template.template.toLowerCase().includes(queryLower)
      );
  }

  /**
   * Recommends template based on task type and content
   */
  recommendTemplate(taskType: TaskType, content: string): PromptTemplate[] {
    const recommendations: PromptTemplate[] = [];

    // Direct category match
    const categoryTemplates = this.getTemplatesByCategory(taskType);
    recommendations.push(...categoryTemplates);

    // Content-based recommendations
    if (content.includes('function') || content.includes('class')) {
      const codeTemplates = this.searchTemplates('code');
      recommendations.push(...codeTemplates.filter(t => !recommendations.some(r => r.id === t.id)));
    }

    if (content.includes('explain') || content.includes('what is')) {
      const explanationTemplates = this.searchTemplates('explanation');
      recommendations.push(...explanationTemplates.filter(t => !recommendations.some(r => r.id === t.id)));
    }

    if (content.includes('compare') || content.includes('vs')) {
      const comparisonTemplates = this.searchTemplates('comparison');
      recommendations.push(...comparisonTemplates.filter(t => !recommendations.some(r => r.id === t.id)));
    }

    return recommendations.slice(0, 5); // Limit to top 5 recommendations
  }

  /**
   * Creates a custom template
   */
  createTemplate(template: Omit<PromptTemplate, 'estimated_tokens'>): PromptTemplate {
    const estimatedTokens = TokenEstimator.estimateFromText(template.template);
    
    const fullTemplate: PromptTemplate = {
      ...template,
      estimated_tokens: estimatedTokens
    };

    this.templates.set(template.id, fullTemplate);
    this.logger.info('Custom template created', { id: template.id });

    return fullTemplate;
  }

  /**
   * Updates an existing template
   */
  updateTemplate(templateId: string, updates: Partial<PromptTemplate>): PromptTemplate {
    const existing = this.templates.get(templateId);
    if (!existing) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const updated: PromptTemplate = {
      ...existing,
      ...updates,
      estimated_tokens: updates.template ? 
        TokenEstimator.estimateFromText(updates.template) : 
        existing.estimated_tokens
    };

    this.templates.set(templateId, updated);
    this.logger.info('Template updated', { id: templateId });

    return updated;
  }

  /**
   * Deletes a template
   */
  deleteTemplate(templateId: string): boolean {
    const deleted = this.templates.delete(templateId);
    if (deleted) {
      this.logger.info('Template deleted', { id: templateId });
    }
    return deleted;
  }

  /**
   * Gets all available templates
   */
  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Gets template by ID
   */
  getTemplate(templateId: string): PromptTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Gets template statistics
   */
  getTemplateStats(): {
    total: number;
    by_category: Record<string, number>;
    cache_eligible: number;
    avg_tokens: number;
  } {
    const templates = this.getAllTemplates();
    const byCategory: Record<string, number> = {};
    let cacheEligible = 0;
    let totalTokens = 0;

    templates.forEach(template => {
      byCategory[template.category] = (byCategory[template.category] || 0) + 1;
      if (template.cache_eligible) cacheEligible++;
      totalTokens += template.estimated_tokens;
    });

    return {
      total: templates.length,
      by_category: byCategory,
      cache_eligible: cacheEligible,
      avg_tokens: templates.length > 0 ? Math.round(totalTokens / templates.length) : 0
    };
  }

  /**
   * Exports templates to JSON
   */
  exportTemplates(): string {
    return JSON.stringify(this.getAllTemplates(), null, 2);
  }

  /**
   * Imports templates from JSON
   */
  importTemplates(jsonData: string): number {
    try {
      const templates: PromptTemplate[] = JSON.parse(jsonData);
      let imported = 0;

      templates.forEach(template => {
        this.templates.set(template.id, template);
        imported++;
      });

      this.logger.info('Templates imported', { count: imported });
      return imported;
    } catch (error) {
      this.logger.error('Failed to import templates', error);
      throw new Error('Invalid JSON format for templates');
    }
  }
}