/**
 * Advanced Vector Cache - Semantic caching with embeddings
 * Based on recommendations from INSIGHTS-V2.md for ~85% hit rate improvement
 * Simplified version using local embeddings without external dependencies
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/Logger.js';

// Enhanced interfaces for vector cache
export interface VectorCacheEntry {
  id: string;
  originalPrompt: string;
  normalizedPrompt: string;
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
    similarity_threshold?: number;
    embedding_model?: string;
  };
}

export interface SimilarityResult {
  entry: VectorCacheEntry;
  similarity: number;
  reason: string;
  vector_distance: number;
}

export interface VectorCacheOptions {
  dataDir: string;
  maxEntries?: number;
  similarityThreshold?: number; // 0-1, where 1 is identical
  embeddingDimensions?: number;
  enablePersistence?: boolean;
  embeddingModel?: string;
  useFaiss?: boolean;
}

export interface CacheHitMetrics {
  literal_hits: number;
  vector_hits: number;
  total_requests: number;
  vector_hit_rate: number;
  average_similarity: number;
}

/**
 * Advanced embedding generator using local algorithms
 */
class LocalEmbeddingGenerator {
  private readonly dimension: number;
  private readonly modelName: string;

  constructor(dimension: number = 384, modelName: string = 'local-minilm') {
    this.dimension = dimension;
    this.modelName = modelName;
  }

  /**
   * Generate embedding using local algorithms
   */
  generate(text: string): number[] {
    const normalized = text.toLowerCase().trim();
    const words = normalized.split(/\s+/);
    const chars = normalized.split('');
    
    const embedding = new Array(this.dimension).fill(0);
    
    // Advanced features based on content
    const features = {
      // Length features
      length: Math.min(normalized.length / 1000, 1),
      wordCount: Math.min(words.length / 100, 1),
      avgWordLength: Math.min((normalized.length / Math.max(words.length, 1)) / 10, 1),
      
      // Content type features
      hasCode: /```|function|class|import|def |const |let |var |=>|async|await/.test(normalized) ? 1 : 0,
      hasQuestion: /\?|como|what|how|why|quando|onde|explain|describe/.test(normalized) ? 1 : 0,
      hasNumbers: /\d+/.test(normalized) ? 1 : 0,
      
      // Domain features
      isTechnical: /api|endpoint|database|server|client|framework|library|package|module/.test(normalized) ? 1 : 0,
      isAnalysis: /analis|explica|descreva|compare|avalie|review|optimize|debug/.test(normalized) ? 1 : 0,
      isCreation: /crie|gere|implemente|desenvolva|construa|build|create|generate/.test(normalized) ? 1 : 0,
      
      // Language features
      isEnglish: /\b(the|and|or|but|with|for|from|this|that)\b/.test(normalized) ? 1 : 0,
      isPortuguese: /\b(de|do|da|para|com|sem|este|esta|aquele|aquela)\b/.test(normalized) ? 1 : 0,
      
      // Complexity features
      hasComplexWords: /\w{10,}/.test(normalized) ? 1 : 0,
      sentenceComplexity: Math.min(words.length / 20, 1),
      
      // Context features
      isCodeReview: /code|review|pr|pull|request|merge|commit|branch/.test(normalized) ? 1 : 0,
      isArchitecture: /architecture|design|pattern|structure|system/.test(normalized) ? 1 : 0,
    };

    // Distribute features across dimensions
    let idx = 0;
    for (const [key, value] of Object.entries(features)) {
      if (idx < this.dimension) {
        embedding[idx] = value;
        idx++;
      }
    }

    // Character n-gram features
    for (let i = 0; i < Math.min(chars.length - 1, this.dimension - idx); i++) {
      const bigram = chars[i] + chars[i + 1];
      const hash = this.hashString(bigram);
      embedding[idx + i] = (hash % 100) / 100;
    }

    // Word frequency features
    const wordFreq: Record<string, number> = {};
    words.forEach(word => {
      if (word.length > 2) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });

    const topWords = Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, Math.min(30, this.dimension - idx - (chars.length - 1)));

    let wordIdx = idx + Math.min(chars.length - 1, this.dimension - idx);
    topWords.forEach(([word, freq]) => {
      if (wordIdx < this.dimension) {
        const hash = this.hashString(word);
        embedding[wordIdx] = Math.min(freq / words.length, 1) * ((hash % 100) / 100);
        wordIdx++;
      }
    });

    // Add positional encoding
    for (let i = 0; i < Math.min(50, this.dimension); i++) {
      embedding[i] += Math.sin(i / 10000) * 0.1;
    }

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
  }

  /**
   * Generate batch embeddings
   */
  generateBatch(texts: string[]): number[][] {
    return texts.map(text => this.generate(text));
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & 0x7fffffff; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  getModelName(): string {
    return this.modelName;
  }

  getDimensions(): number {
    return this.dimension;
  }
}

/**
 * Main Vector Cache class with advanced features
 */
export class VectorCache {
  private entries: Map<string, VectorCacheEntry> = new Map();
  private embeddingGenerator: LocalEmbeddingGenerator;
  private options: Required<VectorCacheOptions>;
  private persistenceFile: string;
  private logger: Logger;
  private metrics: CacheHitMetrics;
  private initialized: boolean = false;

  constructor(options: VectorCacheOptions) {
    this.options = {
      maxEntries: 1000,
      similarityThreshold: 0.85,
      embeddingDimensions: 384,
      enablePersistence: true,
      embeddingModel: 'local-advanced',
      useFaiss: false,
      ...options
    };

    this.embeddingGenerator = new LocalEmbeddingGenerator(
      this.options.embeddingDimensions,
      this.options.embeddingModel
    );

    this.persistenceFile = path.join(this.options.dataDir, 'vector-cache.json');
    this.logger = new Logger('VectorCache');
    
    this.metrics = {
      literal_hits: 0,
      vector_hits: 0,
      total_requests: 0,
      vector_hit_rate: 0,
      average_similarity: 0
    };

    this.initialize().catch(this.logger.error);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (this.options.enablePersistence) {
        await this.loadFromDisk();
      }

      this.initialized = true;
      this.logger.info('Vector cache initialized successfully', {
        entries: this.entries.size,
        model: this.embeddingGenerator.getModelName()
      });
    } catch (error) {
      this.logger.error('Failed to initialize vector cache', { error });
      throw error;
    }
  }

  /**
   * Find similar entries using both literal and semantic matching
   */
  async findSimilar(
    prompt: string,
    model: string,
    taskType?: string
  ): Promise<SimilarityResult | null> {
    await this.ensureInitialized();
    
    this.metrics.total_requests++;

    // Normalize prompt for better matching
    const normalizedPrompt = this.normalizePrompt(prompt);
    
    // First, try literal matching
    const literalMatch = this.findLiteralMatch(normalizedPrompt, model);
    if (literalMatch) {
      this.metrics.literal_hits++;
      return {
        entry: literalMatch,
        similarity: 1.0,
        reason: 'Literal match found',
        vector_distance: 0
      };
    }

    // Then try semantic matching with embeddings
    const semanticMatch = await this.findSemanticMatch(normalizedPrompt, model, taskType);
    if (semanticMatch) {
      this.metrics.vector_hits++;
      this.updateMetrics();
      return semanticMatch;
    }

    return null;
  }

  /**
   * Store new entry in vector cache
   */
  async store(
    prompt: string,
    response: any,
    model: string,
    tokens: number,
    metadata: { task_type?: string; quality_score?: number } = {}
  ): Promise<string> {
    await this.ensureInitialized();

    const normalizedPrompt = this.normalizePrompt(prompt);
    const embedding = this.embeddingGenerator.generate(normalizedPrompt);
    
    const id = this.generateId(normalizedPrompt, model);

    const entry: VectorCacheEntry = {
      id,
      originalPrompt: prompt,
      normalizedPrompt,
      embedding,
      response,
      tokens,
      hits: 0,
      created_at: Date.now(),
      last_accessed: Date.now(),
      metadata: {
        model,
        embedding_model: this.embeddingGenerator.getModelName(),
        similarity_threshold: this.options.similarityThreshold,
        ...metadata
      },
    };

    this.entries.set(id, entry);

    // Cleanup old entries if needed
    if (this.entries.size > this.options.maxEntries) {
      await this.cleanup();
    }

    if (this.options.enablePersistence) {
      this.saveToDisk().catch(this.logger.error);
    }

    return id;
  }

  /**
   * Get comprehensive cache statistics
   */
  getStats(): CacheHitMetrics & {
    total_entries: number;
    embedding_model: string;
    average_similarity_score: number;
    top_similar_queries: Array<{
      prompt: string;
      hits: number;
      similarity: number;
    }>;
  } {
    const entries = Array.from(this.entries.values());
    const topEntries = entries
      .filter(entry => entry.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5);

    return {
      ...this.metrics,
      total_entries: entries.length,
      embedding_model: this.embeddingGenerator.getModelName(),
      average_similarity_score: this.metrics.average_similarity,
      top_similar_queries: topEntries.map(entry => ({
        prompt: entry.originalPrompt.substring(0, 100) + '...',
        hits: entry.hits,
        similarity: this.metrics.average_similarity
      }))
    };
  }

  /**
   * Find literal match (exact or near-exact)
   */
  private findLiteralMatch(normalizedPrompt: string, model: string): VectorCacheEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.metadata.model === model && 
          entry.normalizedPrompt === normalizedPrompt) {
        entry.hits++;
        entry.last_accessed = Date.now();
        return entry;
      }
    }
    return null;
  }

  /**
   * Find semantic match using embeddings
   */
  private async findSemanticMatch(
    normalizedPrompt: string,
    model: string,
    taskType?: string
  ): Promise<SimilarityResult | null> {
    const queryEmbedding = this.embeddingGenerator.generate(normalizedPrompt);
    
    let bestMatch: SimilarityResult | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      if (taskType && entry.metadata.task_type !== taskType) continue;
      if (entry.metadata.model !== model) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      
      if (similarity >= this.options.similarityThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = {
          entry,
          similarity,
          reason: this.getSimilarityReason(similarity, entry, normalizedPrompt),
          vector_distance: Math.sqrt(2 * (1 - similarity)) // Convert cosine to L2
        };
      }
    }

    if (bestMatch) {
      bestMatch.entry.hits++;
      bestMatch.entry.last_accessed = Date.now();
      
      if (this.options.enablePersistence) {
        this.saveToDisk().catch(this.logger.error);
      }
    }

    return bestMatch;
  }

  /**
   * Normalize prompt for better matching
   */
  private normalizePrompt(prompt: string): string {
    return prompt
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.metrics.vector_hit_rate = this.metrics.vector_hits / Math.max(this.metrics.total_requests, 1);
  }

  /**
   * Calculate cosine similarity between vectors
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
   * Get similarity reason
   */
  private getSimilarityReason(similarity: number, entry: VectorCacheEntry, prompt: string): string {
    if (similarity > 0.95) {
      return 'Near-identical query found';
    } else if (similarity > 0.85) {
      return 'Very similar query found - minimal differences';
    } else if (similarity > 0.75) {
      return 'Similar query found - same pattern/context';
    } else {
      return 'Related query found - leveraging cache';
    }
  }

  /**
   * Ensure cache is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Intelligent cleanup
   */
  private async cleanup(): Promise<void> {
    const entries = Array.from(this.entries.values());
    
    // Score based on hits, recency, and quality
    const scored = entries.map(entry => {
      const daysSinceAccess = (Date.now() - entry.last_accessed) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - daysSinceAccess / 30);
      const hitScore = Math.min(1, entry.hits / 10);
      const qualityScore = entry.metadata.quality_score || 0.5;
      
      const combinedScore = (hitScore * 0.4) + (recencyScore * 0.3) + (qualityScore * 0.3);
      
      return { entry, score: combinedScore };
    });

    // Remove 20% lowest scoring entries
    scored.sort((a, b) => a.score - b.score);
    const toRemove = Math.floor(entries.length * 0.2);
    
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(scored[i].entry.id);
    }

    this.logger.info('Vector cache cleanup completed', { removed: toRemove });
  }

  /**
   * Generate unique ID
   */
  private generateId(prompt: string, model: string): string {
    const normalized = this.normalizePrompt(prompt);
    return createHash('sha256')
      .update(`${normalized}:${model}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Persistence
   */
  private async saveToDisk(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.persistenceFile), { recursive: true });
      
      const data = {
        entries: Array.from(this.entries.entries()),
        metrics: this.metrics,
        metadata: {
          savedAt: Date.now(),
          version: '2.0.0',
          options: this.options
        }
      };
      
      await fs.writeFile(this.persistenceFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save vector cache', { error });
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.persistenceFile, 'utf-8'));
      this.entries = new Map(data.entries);
      
      if (data.metrics) {
        this.metrics = { ...this.metrics, ...data.metrics };
      }
      
      this.logger.info('Vector cache loaded from disk', { 
        entries: this.entries.size,
        requests: this.metrics.total_requests 
      });
    } catch (error) {
      this.logger.warn('Failed to load vector cache from disk', { error });
      this.entries = new Map();
    }
  }

  /**
   * Export data for analysis
   */
  exportData() {
    const entries = Array.from(this.entries.values());
    
    return {
      entries,
      stats: this.getStats(),
      embeddings: {
        model: this.embeddingGenerator.getModelName(),
        dimensions: this.embeddingGenerator.getDimensions()
      }
    };
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.metrics = {
      literal_hits: 0,
      vector_hits: 0,
      total_requests: 0,
      vector_hit_rate: 0,
      average_similarity: 0
    };
    
    if (this.options.enablePersistence) {
      try {
        await fs.unlink(this.persistenceFile);
      } catch (error) {
        // File might not exist
      }
    }
  }
}