import Redis from 'ioredis';
import LZString from 'lz-string';
import cron from 'node-cron';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

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

export class SimplePersistentCache {
  private redis: Redis | null = null;
  private jsonCache: Map<string, CacheEntry> = new Map();
  private useRedis: boolean = false;
  private maxMemoryMB: number = 100;
  private defaultTTL: number = 3600;
  private dataDir: string;
  private jsonFilePath: string;

  constructor(options: {
    redisUrl?: string;
    dataDir?: string;
    maxMemoryMB?: number;
    defaultTTL?: number;
  } = {}) {
    this.maxMemoryMB = options.maxMemoryMB || 100;
    this.defaultTTL = options.defaultTTL || 3600;
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
    this.jsonFilePath = path.join(this.dataDir, 'cache.json');

    // Cria diretório se não existir
    this.ensureDir(this.dataDir);
    
    // Carrega cache do JSON
    this.loadFromJSON();

    // Tenta conectar Redis (opcional)
    if (options.redisUrl || process.env.REDIS_URL) {
      try {
        this.redis = new Redis(options.redisUrl || process.env.REDIS_URL!, {
          maxRetriesPerRequest: 3,
          lazyConnect: true
        });
        
        this.redis.on('connect', () => {
          this.useRedis = true;
          console.log('🔴 Redis conectado - Cache quente ativado');
        });
        
        this.redis.on('error', (err) => {
          console.warn('⚠️ Redis indisponível, usando cache JSON:', err.message);
          this.useRedis = false;
        });
      } catch (error) {
        console.warn('⚠️ Redis não configurado, usando cache JSON');
      }
    } else {
      console.log('💾 Usando cache JSON persistente');
    }

    // Agenda tarefas de manutenção
    this.scheduleCleanup();
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadFromJSON() {
    try {
      if (fs.existsSync(this.jsonFilePath)) {
        const data = fs.readFileSync(this.jsonFilePath, 'utf8');
        const entries = JSON.parse(data) as CacheEntry[];
        
        // Filtra entradas expiradas durante o carregamento
        const now = Date.now();
        const validEntries = entries.filter(entry => 
          !entry.expires_at || entry.expires_at > now
        );

        for (const entry of validEntries) {
          this.jsonCache.set(entry.key, entry);
        }
        
        console.log(`📂 Cache carregado: ${validEntries.length} entradas válidas`);
      }
    } catch (error) {
      console.warn('⚠️ Erro carregando cache JSON:', error);
      this.jsonCache.clear();
    }
  }

  private saveToJSON() {
    try {
      const entries = Array.from(this.jsonCache.values());
      fs.writeFileSync(this.jsonFilePath, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.error('❌ Erro salvando cache JSON:', error);
    }
  }

  private scheduleCleanup() {
    // Salva a cada 5 minutos
    cron.schedule('*/5 * * * *', () => {
      this.saveToJSON();
    });

    // Limpeza a cada 30 minutos
    cron.schedule('*/30 * * * *', () => {
      this.cleanup();
    });
  }

  async set(
    key: string, 
    value: any, 
    options: {
      ttl?: number;
      tokens?: number;
      tags?: string[];
      model?: string;
    } = {}
  ): Promise<void> {
    const now = Date.now();
    const id = crypto.randomUUID();
    const serialized = JSON.stringify(value);
    const compressed = LZString.compress(serialized);
    
    const entry: CacheEntry = {
      id,
      key,
      value: compressed,
      tokens: options.tokens || 0,
      hits: 1,
      created_at: now,
      last_accessed: now,
      expires_at: options.ttl ? now + (options.ttl * 1000) : now + (this.defaultTTL * 1000),
      tags: options.tags,
      model: options.model,
      compressed_size: compressed.length,
      original_size: serialized.length
    };

    // Salva no Redis (cache quente)
    if (this.useRedis && this.redis) {
      try {
        await this.redis.setex(
          `mcp:${key}`, 
          options.ttl || this.defaultTTL, 
          JSON.stringify({
            value: compressed,
            tokens: entry.tokens,
            hits: entry.hits,
            model: entry.model
          })
        );
      } catch (error) {
        console.warn('Redis write failed:', error);
      }
    }

    // Salva no cache JSON
    this.jsonCache.set(key, entry);
  }

  async get(key: string): Promise<{value: any, tokens: number, hits: number} | null> {
    // Tenta Redis primeiro (mais rápido)
    if (this.useRedis && this.redis) {
      try {
        const cached = await this.redis.get(`mcp:${key}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          const decompressed = LZString.decompress(parsed.value);
          if (decompressed) {
            // Incrementa hits no cache JSON
            this.incrementHits(key);
            
            return {
              value: JSON.parse(decompressed),
              tokens: parsed.tokens,
              hits: parsed.hits + 1
            };
          }
        }
      } catch (error) {
        console.warn('Redis read failed:', error);
      }
    }

    // Busca no cache JSON
    const entry = this.jsonCache.get(key);
    
    if (entry && (!entry.expires_at || entry.expires_at > Date.now())) {
      const decompressed = LZString.decompress(entry.value);
      if (decompressed) {
        // Incrementa hits e atualiza last_accessed
        this.incrementHits(key);
        
        // Recoloca no Redis se disponível
        if (this.useRedis && this.redis) {
          try {
            const ttlSeconds = Math.floor((entry.expires_at! - Date.now()) / 1000);
            if (ttlSeconds > 0) {
              await this.redis.setex(
                `mcp:${key}`, 
                ttlSeconds, 
                JSON.stringify({
                  value: entry.value,
                  tokens: entry.tokens,
                  hits: entry.hits + 1,
                  model: entry.model
                })
              );
            }
          } catch (error) {
            console.warn('Redis replication failed:', error);
          }
        }

        return {
          value: JSON.parse(decompressed),
          tokens: entry.tokens,
          hits: entry.hits + 1
        };
      }
    }

    return null;
  }

  private incrementHits(key: string) {
    const entry = this.jsonCache.get(key);
    if (entry) {
      entry.hits++;
      entry.last_accessed = Date.now();
      this.jsonCache.set(key, entry);
    }
  }

  async delete(key: string): Promise<boolean> {
    // Remove do Redis
    if (this.useRedis && this.redis) {
      try {
        await this.redis.del(`mcp:${key}`);
      } catch (error) {
        console.warn('Redis delete failed:', error);
      }
    }

    // Remove do cache JSON
    return this.jsonCache.delete(key);
  }

  async getStats(): Promise<CacheStats> {
    const entries = Array.from(this.jsonCache.values());
    const validEntries = entries.filter(entry => 
      !entry.expires_at || entry.expires_at > Date.now()
    );

    const totalHits = validEntries.reduce((sum, entry) => sum + entry.hits, 0);
    const totalTokensSaved = validEntries.reduce((sum, entry) => sum + (entry.tokens * entry.hits), 0);
    const totalSize = validEntries.reduce((sum, entry) => sum + entry.compressed_size, 0);
    const originalTotalSize = validEntries.reduce((sum, entry) => sum + entry.original_size, 0);

    const topKeys = validEntries
      .map(entry => ({
        key: entry.key,
        hits: entry.hits,
        tokens_saved: entry.tokens * entry.hits
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);

    return {
      total_entries: validEntries.length,
      total_hits: totalHits,
      total_tokens_saved: totalTokensSaved,
      cache_size_mb: totalSize / 1024 / 1024,
      hit_rate: totalHits > 0 ? (totalHits / (totalHits + validEntries.length)) * 100 : 0,
      compression_ratio: originalTotalSize > 0 ? totalSize / originalTotalSize : 1,
      top_keys: topKeys
    };
  }

  async cleanup(): Promise<{removed: number, freed_mb: number}> {
    const now = Date.now();
    let removedCount = 0;
    let freedBytes = 0;

    // Remove expirados
    for (const [key, entry] of this.jsonCache.entries()) {
      if (entry.expires_at && entry.expires_at <= now) {
        freedBytes += entry.compressed_size;
        this.jsonCache.delete(key);
        removedCount++;
      }
    }

    // Remove LRU se exceder limite de memória
    const stats = await this.getStats();
    if (stats.cache_size_mb > this.maxMemoryMB) {
      const entries = Array.from(this.jsonCache.entries());
      const sortedByLRU = entries
        .sort(([, a], [, b]) => a.last_accessed - b.last_accessed)
        .sort(([, a], [, b]) => a.hits - b.hits); // Prioriza menos usados

      const excessMB = stats.cache_size_mb - this.maxMemoryMB;
      const targetBytes = excessMB * 1024 * 1024;
      let lruFreedBytes = 0;

      for (const [key, entry] of sortedByLRU) {
        if (lruFreedBytes >= targetBytes) break;
        
        lruFreedBytes += entry.compressed_size;
        this.jsonCache.delete(key);
        removedCount++;
      }
      
      freedBytes += lruFreedBytes;
    }

    // Salva alterações
    this.saveToJSON();

    console.log(`🧹 Limpeza: ${removedCount} entradas removidas, ${(freedBytes / 1024 / 1024).toFixed(2)}MB liberados`);

    return {
      removed: removedCount,
      freed_mb: freedBytes / 1024 / 1024
    };
  }

  async close(): Promise<void> {
    this.saveToJSON();
    if (this.redis) {
      await this.redis.quit();
    }
  }

  // Busca por tags
  async getByTags(tags: string[]): Promise<CacheEntry[]> {
    const results: CacheEntry[] = [];
    const now = Date.now();

    for (const entry of this.jsonCache.values()) {
      if (entry.expires_at && entry.expires_at <= now) continue;
      if (!entry.tags) continue;
      
      const hasMatchingTag = tags.some(tag => entry.tags!.includes(tag));
      if (hasMatchingTag) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.hits - a.hits);
  }

  // Cache warming - pré-carrega no Redis
  async warmCache(topN: number = 50): Promise<void> {
    if (!this.useRedis || !this.redis) return;

    const entries = Array.from(this.jsonCache.values())
      .filter(entry => !entry.expires_at || entry.expires_at > Date.now())
      .sort((a, b) => b.hits - a.hits)
      .slice(0, topN);
    
    for (const entry of entries) {
      try {
        const ttlSeconds = entry.expires_at ? Math.floor((entry.expires_at - Date.now()) / 1000) : this.defaultTTL;
        if (ttlSeconds > 0) {
          await this.redis.setex(
            `mcp:${entry.key}`,
            ttlSeconds,
            JSON.stringify({
              value: entry.value,
              tokens: entry.tokens,
              hits: entry.hits,
              model: entry.model
            })
          );
        }
      } catch (error) {
        console.warn(`Warm cache failed for ${entry.key}:`, error);
      }
    }
    
    console.log(`🔥 Cache warming: ${entries.length} entradas carregadas no Redis`);
  }
}