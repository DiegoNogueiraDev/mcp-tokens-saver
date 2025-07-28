/**
 * Accurate token estimation utilities
 */
export class TokenEstimator {
  private static readonly CHARS_PER_TOKEN = 4.5; // Average for multilingual content
  private static readonly WORD_TO_TOKEN_RATIO = 0.75; // Approximate words to tokens

  /**
   * Estimates tokens from text using character-based calculation
   */
  static estimateFromText(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / TokenEstimator.CHARS_PER_TOKEN);
  }

  /**
   * Estimates tokens from word count
   */
  static estimateFromWords(wordCount: number): number {
    return Math.ceil(wordCount * TokenEstimator.WORD_TO_TOKEN_RATIO);
  }

  /**
   * More accurate estimation considering code vs natural language
   */
  static estimateAccurate(text: string): number {
    if (!text) return 0;

    // Code tends to have more tokens per character
    const isCode = this.detectCode(text);
    const multiplier = isCode ? 1.2 : 1.0;
    
    return Math.ceil((text.length / TokenEstimator.CHARS_PER_TOKEN) * multiplier);
  }

  /**
   * Estimates tokens for a conversation
   */
  static estimateConversation(messages: Array<{role: string, content: string}>): number {
    let total = 0;
    
    for (const message of messages) {
      total += this.estimateFromText(message.content);
      total += 4; // Role and message formatting overhead
    }
    
    total += 2; // Conversation formatting overhead
    return total;
  }

  /**
   * Estimates response tokens based on prompt complexity
   */
  static estimateResponseTokens(prompt: string, responseType: 'short' | 'medium' | 'long' = 'medium'): number {
    const promptTokens = this.estimateFromText(prompt);
    
    const multipliers = {
      'short': 0.5,
      'medium': 1.5,
      'long': 3.0
    };
    
    return Math.ceil(promptTokens * multipliers[responseType]);
  }

  /**
   * Calculates cost based on token count and pricing
   */
  static calculateCost(
    inputTokens: number, 
    outputTokens: number, 
    pricing: { inputCostPer1M: number; outputCostPer1M: number }
  ): number {
    const inputCost = (inputTokens * pricing.inputCostPer1M) / 1000000;
    const outputCost = (outputTokens * pricing.outputCostPer1M) / 1000000;
    return inputCost + outputCost;
  }

  /**
   * Estimates cost savings between two models
   */
  static calculateSavings(
    tokens: { input: number; output: number },
    modelA: { inputCostPer1M: number; outputCostPer1M: number },
    modelB: { inputCostPer1M: number; outputCostPer1M: number }
  ): { absolute: number; percentage: number } {
    const costA = this.calculateCost(tokens.input, tokens.output, modelA);
    const costB = this.calculateCost(tokens.input, tokens.output, modelB);
    
    return {
      absolute: costB - costA,
      percentage: costB > 0 ? ((costB - costA) / costB) * 100 : 0
    };
  }

  private static detectCode(text: string): boolean {
    const codeIndicators = [
      /```/g,
      /function\s+\w+/g,
      /class\s+\w+/g,
      /import\s+.*from/g,
      /const\s+\w+\s*=/g,
      /let\s+\w+\s*=/g,
      /var\s+\w+\s*=/g,
      /def\s+\w+\(/g,
      /public\s+class/g
    ];

    const matches = codeIndicators.reduce((count, pattern) => {
      return count + (text.match(pattern) || []).length;
    }, 0);

    return matches > 0 || text.split('\n').length > 5 && text.includes('{') && text.includes('}');
  }

  /**
   * Provides token usage breakdown for analysis
   */
  static analyzeTokenUsage(text: string): {
    total: number;
    type: 'code' | 'natural' | 'mixed';
    complexity: 'low' | 'medium' | 'high';
    cacheRecommendation: boolean;
  } {
    const total = this.estimateFromText(text);
    const isCode = this.detectCode(text);
    const lines = text.split('\n').length;
    const words = text.split(/\s+/).length;
    
    const type = isCode ? 'code' : words > lines * 3 ? 'natural' : 'mixed';
    
    let complexity: 'low' | 'medium' | 'high' = 'low';
    if (total > 500) complexity = 'high';
    else if (total > 100) complexity = 'medium';
    
    const cacheRecommendation = total > 50 && (complexity !== 'low' || isCode);

    return {
      total,
      type,
      complexity,
      cacheRecommendation
    };
  }
}