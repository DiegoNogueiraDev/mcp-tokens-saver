import { CacheDecision, TaskType } from '../types/index.js';
import { Logger } from '../utils/Logger.js';

/**
 * Advanced heuristics for intelligent caching decisions
 */
export class CacheHeuristics {
  private logger: Logger;
  private patterns: Map<string, number> = new Map();

  constructor() {
    this.logger = new Logger('CacheHeuristics');
    this.initializePatterns();
  }

  private initializePatterns() {
    // Weighted patterns for caching decisions
    this.patterns.set('reusable-pattern', 25);
    this.patterns.set('code-pattern', 20);
    this.patterns.set('debug-pattern', 15);
    this.patterns.set('educational-pattern', 15);
    this.patterns.set('improvement-pattern', 20);
    this.patterns.set('complex-context', 30);
    this.patterns.set('code-content', 25);
    this.patterns.set('programming-language', 20);
  }

  /**
   * Evaluates whether content should be cached based on intelligent heuristics
   */
  evaluateCachingDecision(prompt: string, context?: string, response?: any): CacheDecision {
    const promptTokens = this.estimateTokens(prompt);
    const contextTokens = context ? this.estimateTokens(context) : 0;
    const responseTokens = response ? this.estimateTokens(response.choices?.[0]?.message?.content || '') : 0;
    const totalTokens = promptTokens + contextTokens + responseTokens;

    let score = 0;
    let reasons: string[] = [];
    let ttl = 3600; // Default 1 hour

    // Rule 1: Minimum size requirement
    if (totalTokens >= 100) {
      score += 20;
      reasons.push('tokens>=100');
    } else if (totalTokens >= 50) {
      score += 10;
      reasons.push('tokens>=50');
    }

    // Rule 2: Reusability patterns
    score += this.evaluatePatterns(prompt, reasons, context);

    // Rule 3: Context complexity
    if (context && context.length > 500) {
      score += this.patterns.get('complex-context') || 0;
      reasons.push('complex-context');
      ttl = 7200; // 2 hours for complex contexts
    }

    // Rule 4: Response size
    if (responseTokens > 200) {
      score += 15;
      reasons.push('large-response');
    }

    // Rule 5: Code detection
    if (/```|function|class|import|export|const|let|var/.test(prompt)) {
      score += this.patterns.get('code-content') || 0;
      reasons.push('code-content');
      ttl = 5400; // 1.5 hours for code
    }

    // Rule 6: Programming languages
    const languages = ['javascript', 'typescript', 'python', 'java', 'react', 'node.js', 'sql'];
    if (languages.some(lang => this.containsLanguage(prompt, context, lang))) {
      score += this.patterns.get('programming-language') || 0;
      reasons.push('programming-language');
    }

    // Rule 7: Question patterns
    if (/^(how|what|why|when|where|explain|describe|analyze)/i.test(prompt.trim())) {
      score += 15;
      reasons.push('question-pattern');
    }

    // Rule 8: Task complexity
    const taskComplexity = this.assessTaskComplexity(prompt, context);
    score += taskComplexity.score;
    if (taskComplexity.reason) {
      reasons.push(taskComplexity.reason);
    }

    // Decision threshold (lowered for better inclusivity)
    const shouldCache = score >= 25;
    const estimatedSavings = shouldCache ? Math.floor(totalTokens * 0.8) : 0;

    this.logger.debug('Caching decision', {
      score,
      shouldCache,
      reasons: reasons.join(', '),
      totalTokens
    });

    return {
      shouldCache,
      reason: shouldCache ? reasons.join(', ') : `low-score: ${score}`,
      estimatedSavings,
      ttl
    };
  }

  private evaluatePatterns(prompt: string, reasons: string[], context?: string): number {
    const content = `${prompt} ${context || ''}`.toLowerCase();
    let score = 0;

    const patternTests = [
      { pattern: /analys|review|explain|debug|document|generate/i, key: 'reusable-pattern' },
      { pattern: /function|class|component|api|endpoint/i, key: 'code-pattern' },
      { pattern: /error|bug|fix|issue|problem/i, key: 'debug-pattern' },
      { pattern: /how to|what is|explain|tutorial/i, key: 'educational-pattern' },
      { pattern: /refactor|optimize|improve|enhance/i, key: 'improvement-pattern' }
    ];

    for (const test of patternTests) {
      if (test.pattern.test(content)) {
        const patternScore = this.patterns.get(test.key) || 0;
        score += patternScore;
        reasons.push(test.key);
        break; // Only the first match to avoid double counting
      }
    }

    return score;
  }

  private containsLanguage(prompt: string, context: string | undefined, language: string): boolean {
    const content = `${prompt} ${context || ''}`.toLowerCase();
    return content.includes(language.toLowerCase());
  }

  private assessTaskComplexity(prompt: string, context?: string): { score: number; reason?: string } {
    const content = `${prompt} ${context || ''}`;
    
    // Multi-step tasks
    if (/first.*then|step.*step|1\.|2\.|next/i.test(content)) {
      return { score: 20, reason: 'multi-step-task' };
    }

    // Complex analysis
    if (/comprehensive|detailed|thorough|complete|in-depth/i.test(content)) {
      return { score: 15, reason: 'complex-analysis' };
    }

    // Comparison tasks
    if (/compare|contrast|versus|vs|difference|similar/i.test(content)) {
      return { score: 12, reason: 'comparison-task' };
    }

    return { score: 0 };
  }

  /**
   * Adjusts heuristics based on cache performance
   */
  adjustHeuristics(hitRate: number, averageTokensSaved: number): void {
    // Auto-tune based on performance
    if (hitRate < 0.2) {
      // Low hit rate - relax criteria
      this.patterns.forEach((value, key) => {
        this.patterns.set(key, Math.max(value - 2, 5));
      });
      this.logger.info('Relaxed heuristics due to low hit rate', { hitRate });
    } else if (hitRate > 0.8) {
      // Very high hit rate - tighten criteria slightly
      this.patterns.forEach((value, key) => {
        this.patterns.set(key, value + 1);
      });
      this.logger.info('Tightened heuristics due to high hit rate', { hitRate });
    }
  }

  /**
   * Extract semantic tags from content
   */
  extractTags(prompt: string, context?: string): string[] {
    const content = `${prompt} ${context || ''}`.toLowerCase();
    const tags: string[] = [];
    
    // Technology tags
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
    
    // Task type tags
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

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4.5);
  }

  /**
   * Get current heuristic weights for debugging
   */
  getCurrentWeights(): Map<string, number> {
    return new Map(this.patterns);
  }
}