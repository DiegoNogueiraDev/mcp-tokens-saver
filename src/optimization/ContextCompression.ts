/**
 * Context Compression - Implementa técnicas de compressão baseadas no Azure LLM Latency Guidebook
 * Reduz tokens mantendo informação essencial
 */

export interface CompressionResult {
  originalText: string;
  compressedText: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  technique: string;
  qualityScore: number; // 0-1, onde 1 é qualidade perfeita
}

export interface CompressionOptions {
  maxTokens?: number;
  preserveStructure?: boolean;
  aggressiveness?: 'conservative' | 'moderate' | 'aggressive';
  contextType?: 'conversation' | 'documentation' | 'code' | 'general';
}

export class ContextCompression {
  private static readonly TOKEN_RATIO = 4.5; // Aproximação: 1 token ≈ 4.5 chars em inglês

  /**
   * Estimate token count from text
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / this.TOKEN_RATIO);
  }

  /**
   * Main compression method - escolhe a melhor técnica automaticamente
   */
  static compress(
    text: string, 
    options: CompressionOptions = {}
  ): CompressionResult {
    const originalTokens = this.estimateTokens(text);
    const {
      maxTokens = Math.floor(originalTokens * 0.5),
      aggressiveness = 'moderate',
      contextType = 'general'
    } = options;

    // Se já está dentro do limite, não comprime
    if (originalTokens <= maxTokens) {
      return {
        originalText: text,
        compressedText: text,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 1.0,
        technique: 'no-compression',
        qualityScore: 1.0
      };
    }

    // Escolhe técnica baseada no tipo de contexto e agressividade
    let result: CompressionResult;

    switch (contextType) {
      case 'conversation':
        result = this.compressConversation(text, maxTokens, aggressiveness);
        break;
      case 'documentation':
        result = this.compressDocumentation(text, maxTokens, aggressiveness);
        break;
      case 'code':
        result = this.compressCode(text, maxTokens, aggressiveness);
        break;
      default:
        result = this.compressGeneral(text, maxTokens, aggressiveness);
    }

    return result;
  }

  /**
   * Compressão para conversas - mantém últimas mensagens e sumários
   */
  private static compressConversation(
    text: string, 
    maxTokens: number, 
    aggressiveness: string
  ): CompressionResult {
    const lines = text.split('\n').filter(line => line.trim());
    const originalTokens = this.estimateTokens(text);
    
    // Identifica mensagens por padrões comuns (User:, Assistant:, etc.)
    const messages: Array<{content: string, role: string, tokens: number}> = [];
    let currentMessage = '';
    let currentRole = 'unknown';

    for (const line of lines) {
      const roleMatch = line.match(/^(User|Assistant|Human|AI|System):\s*(.*)/i);
      if (roleMatch) {
        if (currentMessage) {
          messages.push({
            content: currentMessage.trim(),
            role: currentRole,
            tokens: this.estimateTokens(currentMessage)
          });
        }
        currentRole = roleMatch[1].toLowerCase();
        currentMessage = roleMatch[2] || '';
      } else {
        currentMessage += '\n' + line;
      }
    }

    // Adiciona última mensagem
    if (currentMessage) {
      messages.push({
        content: currentMessage.trim(),
        role: currentRole,
        tokens: this.estimateTokens(currentMessage)
      });
    }

    // Estratégia: mantém últimas N mensagens + sumário das anteriores
    const keepRecentCount = aggressiveness === 'conservative' ? 6 : 
                           aggressiveness === 'moderate' ? 4 : 2;
    
    const recentMessages = messages.slice(-keepRecentCount);
    const olderMessages = messages.slice(0, -keepRecentCount);
    
    let compressed = '';
    
    // Cria sumário das mensagens antigas
    if (olderMessages.length > 0) {
      const topics = this.extractTopics(olderMessages.map(m => m.content).join('\n'));
      compressed += `[Sumário das ${olderMessages.length} mensagens anteriores: ${topics}]\n\n`;
    }
    
    // Adiciona mensagens recentes
    for (const msg of recentMessages) {
      compressed += `${msg.role}: ${msg.content}\n`;
    }

    const compressedTokens = this.estimateTokens(compressed);
    
    return {
      originalText: text,
      compressedText: compressed.trim(),
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      technique: 'conversation-summary',
      qualityScore: Math.max(0.6, 1 - (originalTokens - compressedTokens) / originalTokens * 0.5)
    };
  }

  /**
   * Compressão para documentação - mantém estrutura e pontos-chave
   */
  private static compressDocumentation(
    text: string, 
    maxTokens: number, 
    aggressiveness: string
  ): CompressionResult {
    const originalTokens = this.estimateTokens(text);
    
    // Remove redundâncias e exemplos excessivos
    let compressed = text
      // Remove múltiplas linhas vazias
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      // Remove comentários verbose
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Comprime exemplos longos
      .replace(/```[\s\S]{200,}?```/g, '[código de exemplo omitido]')
      // Remove explicações redundantes
      .replace(/\b(como mencionado anteriormente|conforme explicado|vale notar que|é importante destacar)\b[^.]*\./gi, '');

    if (aggressiveness === 'aggressive') {
      compressed = compressed
        // Remove parágrafos de introdução/conclusão genéricos
        .replace(/^(Introdução|Conclusão|Em resumo)[\s\S]{50,}?(?=\n#|\n\n|$)/gm, '')
        // Simplifica frases longas
        .replace(/\b(que é utilizado para|que tem como objetivo|com a finalidade de)\b/gi, 'para')
        .replace(/\b(possibilita a|permite que|torna possível)\b/gi, 'permite');
    }

    const compressedTokens = this.estimateTokens(compressed);

    return {
      originalText: text,
      compressedText: compressed.trim(),
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      technique: 'documentation-cleanup',
      qualityScore: Math.max(0.7, 1 - Math.abs(compressedTokens - originalTokens) / originalTokens * 0.3)
    };
  }

  /**
   * Compressão para código - mantém lógica essencial
   */
  private static compressCode(
    text: string, 
    maxTokens: number, 
    aggressiveness: string
  ): CompressionResult {
    const originalTokens = this.estimateTokens(text);
    
    let compressed = text
      // Remove comentários de linha
      .replace(/\/\/.*$/gm, '')
      // Remove comentários de bloco
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove linhas vazias excessivas
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      // Remove espaços desnecessários
      .replace(/\s+/g, ' ')
      .replace(/\s*{\s*/g, '{')
      .replace(/\s*}\s*/g, '}')
      .replace(/\s*;\s*/g, ';');

    if (aggressiveness === 'aggressive') {
      compressed = compressed
        // Remove imports não essenciais (heurística)
        .replace(/^import\s+[^;]+;$/gm, '')
        // Simplifica console.log e debug
        .replace(/console\.(log|debug|info)\([^)]*\);?/g, '')
        // Remove código de exemplo/teste inline
        .replace(/\/\/ TEST:[\s\S]*?$/gm, '');
    }

    const compressedTokens = this.estimateTokens(compressed);

    return {
      originalText: text,
      compressedText: compressed.trim(),
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      technique: 'code-minification',
      qualityScore: Math.max(0.8, 1 - Math.abs(compressedTokens - originalTokens) / originalTokens * 0.2)
    };
  }

  /**
   * Compressão geral - técnicas universais
   */
  private static compressGeneral(
    text: string, 
    maxTokens: number, 
    aggressiveness: string
  ): CompressionResult {
    const originalTokens = this.estimateTokens(text);
    
    // Técnica de sumarização baseada em sentenças importantes
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const sentenceScores = sentences.map(sentence => ({
      sentence: sentence.trim(),
      score: this.scoreSentence(sentence),
      tokens: this.estimateTokens(sentence)
    }));

    // Ordena por importância
    sentenceScores.sort((a, b) => b.score - a.score);

    // Seleciona sentenças até o limite de tokens
    let currentTokens = 0;
    const selectedSentences: string[] = [];
    
    for (const sentData of sentenceScores) {
      if (currentTokens + sentData.tokens <= maxTokens) {
        selectedSentences.push(sentData.sentence);
        currentTokens += sentData.tokens;
      }
    }

    // Reconstrói o texto mantendo ordem lógica
    let compressed = '';
    for (const sentence of sentences) {
      if (selectedSentences.includes(sentence.trim())) {
        compressed += sentence + ' ';
      }
    }

    const compressedTokens = this.estimateTokens(compressed);

    return {
      originalText: text,
      compressedText: compressed.trim(),
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      technique: 'sentence-ranking',
      qualityScore: Math.max(0.5, selectedSentences.length / sentences.length)
    };
  }

  /**
   * Pontua importância de uma sentença
   */
  private static scoreSentence(sentence: string): number {
    let score = 0;
    
    // Palavras-chave importantes
    const keywords = [
      'importante', 'essencial', 'crítico', 'fundamental', 'principal',
      'problema', 'solução', 'erro', 'fix', 'implementar', 'configurar'
    ];
    
    for (const keyword of keywords) {
      if (sentence.toLowerCase().includes(keyword)) {
        score += 2;
      }
    }
    
    // Sentenças com números/dados específicos são importantes
    if (/\d+/.test(sentence)) {
      score += 1;
    }
    
    // Sentenças curtas e diretas são preferíveis
    if (sentence.length < 100) {
      score += 1;
    }
    
    // Penaliza sentenças muito longas
    if (sentence.length > 200) {
      score -= 1;
    }

    return score;
  }

  /**
   * Extrai tópicos principais de um texto
   */
  private static extractTopics(text: string): string {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    // Conta frequência de palavras
    const wordCount: Record<string, number> = {};
    for (const word of words) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
    
    // Pega as 5 palavras mais frequentes
    const topWords = Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);
    
    return topWords.join(', ');
  }

  /**
   * Compressão automática com múltiplas tentativas
   */
  static smartCompress(
    text: string,
    targetTokens: number,
    options: CompressionOptions = {}
  ): CompressionResult {
    const techniques = ['conservative', 'moderate', 'aggressive'] as const;
    let bestResult: CompressionResult | null = null;
    
    for (const aggressiveness of techniques) {
      const result = this.compress(text, {
        ...options,
        maxTokens: targetTokens,
        aggressiveness
      });
      
      if (result.compressedTokens <= targetTokens) {
        if (!bestResult || result.qualityScore > bestResult.qualityScore) {
          bestResult = result;
        }
      }
    }
    
    // Se nenhuma técnica conseguiu atingir o target, retorna a melhor tentativa
    return bestResult || this.compress(text, {
      ...options,
      maxTokens: targetTokens,
      aggressiveness: 'aggressive'
    });
  }
}