/**
 * Vector Cache - Cache semântico baseado em embeddings para consultas similares
 * Baseado nas recomendações do MemGPT/Letta para elevar hit-rate para ~85%
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface VectorCacheEntry {
  id: string;
  originalPrompt: string;
  embedding: number[];
  response: any;
  tokens: number;
  hits: number;
  created_at: number;
  last_accessed: number;
  metadata: {
    model: string;
    task_type?: string;
    quality_score?: number;
  };
}

export interface SimilarityResult {
  entry: VectorCacheEntry;
  similarity: number;
  reason: string;
}

export interface VectorCacheOptions {
  dataDir: string;
  maxEntries?: number;
  similarityThreshold?: number; // 0-1, onde 1 é idêntico
  embeddingDimensions?: number;
  enablePersistence?: boolean;
}

/**
 * Simple embedding generator usando heurísticas locais
 * Para produção, consideraria integrações com OpenAI Embeddings ou modelos locais
 */
class SimpleEmbeddingGenerator {
  private readonly dimension: number;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
  }

  /**
   * Gera embedding simples baseado em características do texto
   * TODO: Integrar com modelos de embedding mais sofisticados
   */
  generate(text: string): number[] {
    const normalized = text.toLowerCase().trim();
    const words = normalized.split(/\s+/);
    const chars = normalized.split('');
    
    const embedding = new Array(this.dimension).fill(0);
    
    // Features baseadas em conteúdo
    const features = {
      // Características de tamanho
      length: Math.min(normalized.length / 1000, 1),
      wordCount: Math.min(words.length / 100, 1),
      avgWordLength: Math.min((normalized.length / words.length) / 10, 1),
      
      // Características de tipo
      hasCode: /```|function|class|import|def |const |let |var /.test(normalized) ? 1 : 0,
      hasQuestion: /\?|como|what|how|why|quando|onde/.test(normalized) ? 1 : 0,
      hasNumbers: /\d+/.test(normalized) ? 1 : 0,
      
      // Características de domínio
      isTechnical: /api|endpoint|database|server|client|framework/.test(normalized) ? 1 : 0,
      isAnalysis: /analis|explica|descreva|compare|avalie/.test(normalized) ? 1 : 0,
      isCreation: /crie|gere|implemente|desenvolva|construa/.test(normalized) ? 1 : 0,
    };

    // Distribui features pelos primeiros indices
    let idx = 0;
    for (const [key, value] of Object.entries(features)) {
      if (idx < this.dimension) {
        embedding[idx] = value;
        idx++;
      }
    }

    // Características de n-gramas de caracteres
    for (let i = 0; i < Math.min(chars.length - 1, this.dimension - idx); i++) {
      const bigram = chars[i] + chars[i + 1];
      const hash = this.hashString(bigram);
      embedding[idx + i] = (hash % 100) / 100; // Normaliza 0-1
    }

    // Características de palavras frequentes
    const wordFreq: Record<string, number> = {};
    words.forEach(word => {
      if (word.length > 2) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });

    const topWords = Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, Math.min(20, this.dimension - idx - (chars.length - 1)));

    let wordIdx = idx + Math.min(chars.length - 1, this.dimension - idx);
    topWords.forEach(([word, freq]) => {
      if (wordIdx < this.dimension) {
        const hash = this.hashString(word);
        embedding[wordIdx] = Math.min(freq / words.length, 1) * ((hash % 100) / 100);
        wordIdx++;
      }
    });

    // Normaliza o vetor
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

export class VectorCache {
  private entries: Map<string, VectorCacheEntry> = new Map();
  private embeddingGenerator: SimpleEmbeddingGenerator;
  private options: Required<VectorCacheOptions>;
  private persistenceFile: string;

  constructor(options: VectorCacheOptions) {
    this.options = {
      maxEntries: 1000,
      similarityThreshold: 0.75, // 75% similarity threshold
      embeddingDimensions: 384,
      enablePersistence: true,
      ...options
    };

    this.embeddingGenerator = new SimpleEmbeddingGenerator(this.options.embeddingDimensions);
    this.persistenceFile = path.join(this.options.dataDir, 'vector-cache.json');
    
    if (this.options.enablePersistence) {
      this.loadFromDisk().catch(console.error);
    }
  }

  /**
   * Busca entrada similar no cache
   */
  async findSimilar(
    prompt: string,
    model: string,
    taskType?: string
  ): Promise<SimilarityResult | null> {
    const queryEmbedding = this.embeddingGenerator.generate(prompt);
    let bestMatch: SimilarityResult | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      // Filtro básico por modelo (opcional - pode relaxar para melhorar hit rate)
      if (entry.metadata.model !== model && this.options.similarityThreshold > 0.8) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      
      if (similarity >= this.options.similarityThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = {
          entry,
          similarity,
          reason: this.getSimilarityReason(similarity, entry, prompt)
        };
      }
    }

    if (bestMatch) {
      // Atualiza estatísticas de acesso
      bestMatch.entry.hits++;
      bestMatch.entry.last_accessed = Date.now();
      
      if (this.options.enablePersistence) {
        this.saveToDisk().catch(console.error);
      }
    }

    return bestMatch;
  }

  /**
   * Armazena nova entrada no cache
   */
  async store(
    prompt: string,
    response: any,
    model: string,
    tokens: number,
    metadata: { task_type?: string; quality_score?: number } = {}
  ): Promise<string> {
    const id = this.generateId(prompt, model);
    const embedding = this.embeddingGenerator.generate(prompt);

    const entry: VectorCacheEntry = {
      id,
      originalPrompt: prompt,
      embedding,
      response,
      tokens,
      hits: 0,
      created_at: Date.now(),
      last_accessed: Date.now(),
      metadata: {
        model,
        ...metadata
      }
    };

    this.entries.set(id, entry);

    // Limpa entradas antigas se exceder limite
    if (this.entries.size > this.options.maxEntries) {
      await this.cleanup();
    }

    if (this.options.enablePersistence) {
      this.saveToDisk().catch(console.error);
    }

    return id;
  }

  /**
   * Análise de eficiência do vector cache
   */
  getEfficiencyAnalysis(): {
    totalEntries: number;
    totalHits: number;
    averageSimilarity: number;
    hitRate: number;
    topSimilarQueries: Array<{
      prompt: string;
      hits: number;
      similarity: number;
    }>;
    recommendations: string[];
  } {
    const entries = Array.from(this.entries.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    const totalRequests = totalHits + entries.length; // Approximation
    
    const topEntries = entries
      .filter(entry => entry.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5);

    const averageSimilarity = entries.length > 1 ? 
      this.calculateAverageSimilarity(entries) : 0;

    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

    const recommendations: string[] = [];
    
    if (hitRate < 0.3) {
      recommendations.push('Hit rate baixo - considere reduzir similarityThreshold para 0.65');
    }
    
    if (averageSimilarity < 0.4) {
      recommendations.push('Consultas muito diversas - considere categorização por task_type');
    }
    
    if (entries.length > this.options.maxEntries * 0.9) {
      recommendations.push('Cache próximo do limite - aumente maxEntries ou execute cleanup');
    }

    if (topEntries.length < 3) {
      recommendations.push('Poucos padrões identificados - aguarde mais dados para otimização');
    }

    return {
      totalEntries: entries.length,
      totalHits,
      averageSimilarity,
      hitRate,
      topSimilarQueries: topEntries.map(entry => ({
        prompt: entry.originalPrompt.substring(0, 100) + '...',
        hits: entry.hits,
        similarity: averageSimilarity
      })),
      recommendations
    };
  }

  /**
   * Limpeza inteligente de entradas antigas
   */
  private async cleanup(): Promise<void> {
    const entries = Array.from(this.entries.values());
    
    // Ordena por score combinado: hits (peso 0.4) + recência (peso 0.3) + qualidade (peso 0.3)
    const scored = entries.map(entry => {
      const daysSinceAccess = (Date.now() - entry.last_accessed) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - daysSinceAccess / 30); // Decai ao longo de 30 dias
      const hitScore = Math.min(1, entry.hits / 10); // Normaliza hits até 10
      const qualityScore = entry.metadata.quality_score || 0.5;
      
      const combinedScore = (hitScore * 0.4) + (recencyScore * 0.3) + (qualityScore * 0.3);
      
      return { entry, score: combinedScore };
    });

    // Remove 20% das entradas com menor score
    scored.sort((a, b) => a.score - b.score);
    const toRemove = Math.floor(entries.length * 0.2);
    
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(scored[i].entry.id);
    }
  }

  /**
   * Calcula similaridade de cosseno entre dois vetores
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Gera explicação da similaridade encontrada
   */
  private getSimilarityReason(similarity: number, entry: VectorCacheEntry, currentPrompt: string): string {
    if (similarity > 0.95) {
      return 'Consulta quase idêntica encontrada';
    } else if (similarity > 0.85) {
      return 'Consulta muito similar encontrada - diferenças mínimas';
    } else if (similarity > 0.75) {
      return 'Consulta similar encontrada - mesmo padrão/contexto';
    } else {
      return 'Consulta relacionada encontrada - aproveitando cache';
    }
  }

  /**
   * Calcula similaridade média entre todas as entradas
   */
  private calculateAverageSimilarity(entries: VectorCacheEntry[]): number {
    if (entries.length < 2) return 0;
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    // Amostra até 50 comparações para performance
    const maxComparisons = Math.min(50, entries.length * (entries.length - 1) / 2);
    
    for (let i = 0; i < entries.length && comparisons < maxComparisons; i++) {
      for (let j = i + 1; j < entries.length && comparisons < maxComparisons; j++) {
        totalSimilarity += this.cosineSimilarity(entries[i].embedding, entries[j].embedding);
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private generateId(prompt: string, model: string): string {
    return createHash('sha256')
      .update(`${prompt}:${model}:${Date.now()}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Persistência em disco
   */
  private async saveToDisk(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistenceFile), { recursive: true });
      const data = {
        entries: Array.from(this.entries.entries()),
        metadata: {
          savedAt: Date.now(),
          version: '1.0.0',
          options: this.options
        }
      };
      await fs.writeFile(this.persistenceFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save vector cache to disk:', error);
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.persistenceFile, 'utf-8'));
      this.entries = new Map(data.entries);
    } catch (error) {
      // File doesn't exist or is corrupted - start fresh
      this.entries = new Map();
    }
  }

  /**
   * Exporta dados para análise externa
   */
  exportData(): {
    entries: VectorCacheEntry[];
    statistics: {
      totalEntries: number;
      totalHits: number;
      avgHitsPerEntry: number;
      oldestEntry: number;
      newestEntry: number;
    };
  } {
    const entries = Array.from(this.entries.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hits, 0);
    const creationTimes = entries.map(entry => entry.created_at);

    return {
      entries,
      statistics: {
        totalEntries: entries.length,
        totalHits,
        avgHitsPerEntry: entries.length > 0 ? totalHits / entries.length : 0,
        oldestEntry: Math.min(...creationTimes),
        newestEntry: Math.max(...creationTimes)
      }
    };
  }

  /**
   * Limpa todo o cache
   */
  async clear(): Promise<void> {
    this.entries.clear();
    if (this.options.enablePersistence) {
      try {
        await fs.unlink(this.persistenceFile);
      } catch (error) {
        // File might not exist
      }
    }
  }
}