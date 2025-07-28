# Vector Cache System Guide

## Overview

The Vector Cache system provides semantic similarity caching for the MCP Token Saver, implementing advanced embedding-based caching to achieve ~85% hit rate improvement as recommended in INSIGHTS-V2.md.

## Architecture

The system implements a multi-layer caching approach:

1. **Literal Cache**: Exact string matching for identical queries
2. **Vector Cache**: Semantic similarity using embeddings for near-identical queries
3. **Hybrid Strategy**: Combines both approaches for maximum efficiency

## Key Features

- **Semantic Similarity**: Uses advanced local embeddings to find similar queries
- **Multi-layer Caching**: Integrates with existing CacheEngine
- **Configurable Thresholds**: Adjustable similarity thresholds (0.0-1.0)
- **Persistence**: Automatic disk-based persistence
- **Performance Metrics**: Comprehensive hit/miss tracking
- **Intelligent Cleanup**: Automatic management of cache size

## Usage

### Basic Vector Cache

```typescript
import { VectorCache } from './src/cache/VectorCache.js';

const vectorCache = new VectorCache({
  dataDir: './data',
  maxEntries: 1000,
  similarityThreshold: 0.85,
  embeddingDimensions: 384,
  enablePersistence: true
});

// Store a response
await vectorCache.store(
  "How do I create a React component?",
  response,
  "gpt-4",
  150,
  { task_type: "coding", quality_score: 0.9 }
);

// Find similar queries
const result = await vectorCache.findSimilar(
  "What's the best way to build a React component?",
  "gpt-4",
  "coding"
);
```

### Multi-layer Cache Integration

```typescript
import { CacheEngine } from './src/core/CacheEngine.js';

const cacheEngine = new CacheEngine({
  dataDir: './data',
  enableVectorCache: true,
  vectorCacheOptions: {
    maxEntries: 1000,
    similarityThreshold: 0.8,
    embeddingModel: 'local-advanced'
  }
});

// Automatic multi-layer caching
const result = await cacheEngine.get(prompt, context, model, taskType);
await cacheEngine.set(prompt, response, { model, tokens, taskType });
```

## Configuration Options

### VectorCacheOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dataDir` | string | required | Directory for cache persistence |
| `maxEntries` | number | 1000 | Maximum cache entries |
| `similarityThreshold` | number | 0.85 | Similarity threshold (0.0-1.0) |
| `embeddingDimensions` | number | 384 | Embedding vector dimensions |
| `enablePersistence` | boolean | true | Enable disk persistence |
| `embeddingModel` | string | 'local-advanced' | Embedding model identifier |

### CacheEngine Integration

```typescript
interface EnhancedCacheOptions {
  // Standard cache options
  redisUrl?: string;
  dataDir?: string;
  maxMemoryMB?: number;
  defaultTTL?: number;
  
  // Vector cache options
  enableVectorCache?: boolean;
  vectorCacheOptions?: {
    maxEntries?: number;
    similarityThreshold?: number;
    embeddingModel?: string;
  };
}
```

## Performance Metrics

The system provides comprehensive metrics:

```typescript
const stats = vectorCache.getStats();
console.log({
  total_entries: stats.total_entries,
  vector_hits: stats.vector_hits,
  literal_hits: stats.literal_hits,
  vector_hit_rate: stats.vector_hit_rate,
  average_similarity_score: stats.average_similarity_score
});
```

## Embedding Strategy

The system uses a sophisticated local embedding approach:

1. **Content Analysis**: Length, complexity, and type detection
2. **Domain Detection**: Technical, analysis, creation patterns
3. **Language Features**: English/Portuguese detection
4. **N-gram Features**: Character and word-level patterns
5. **Normalization**: Consistent text preprocessing

## Similarity Calculation

- **Cosine Similarity**: Measures angle between vectors
- **Threshold-based**: Configurable similarity cutoff
- **Multi-factor**: Combines various similarity signals
- **Performance Optimized**: Efficient vector operations

## Use Cases

### 1. Code Assistance
```typescript
// Similar queries will hit cache
"How to use useState in React?"
"useState hook React example"
"React useState usage"
```

### 2. Documentation
```typescript
// Context-aware similarity
"Explain TypeScript interfaces"
"TypeScript interface guide"
"How do interfaces work in TypeScript?"
```

### 3. Debugging
```typescript
// Error pattern matching
"React useEffect infinite loop"
"useEffect causing infinite re-renders"
"Fix useEffect dependency array"
```

## Best Practices

### 1. Threshold Tuning
- **High Precision**: 0.9+ (fewer false positives)
- **Balanced**: 0.8-0.85 (good trade-off)
- **High Recall**: 0.7-0.75 (more matches)

### 2. Task Type Categorization
```typescript
// Use task types for better grouping
await cache.store(prompt, response, model, tokens, {
  task_type: "coding" | "analysis" | "debugging" | "documentation"
});
```

### 3. Quality Scoring
```typescript
// Rate responses for better cache prioritization
await cache.store(prompt, response, model, tokens, {
  quality_score: 0.9 // High quality response
});
```

## Monitoring and Analytics

### Key Metrics to Track
- **Hit Rate**: Percentage of cache hits
- **Similarity Distribution**: Average similarity scores
- **Cache Efficiency**: Tokens saved vs. storage cost
- **Query Patterns**: Most common similar queries

### Example Analytics
```typescript
const analysis = vectorCache.exportData();
console.log(`Most similar queries:`, analysis.top_similar_queries);
console.log(`Cache efficiency:`, analysis.stats);
```

## Troubleshooting

### Common Issues

1. **Low Hit Rate**
   - Lower similarity threshold
   - Increase max entries
   - Check embedding quality

2. **High Memory Usage**
   - Reduce max entries
   - Implement more aggressive cleanup
   - Lower embedding dimensions

3. **Slow Performance**
   - Optimize similarity threshold
   - Use task type filtering
   - Consider batch operations

### Debug Mode
```typescript
const cache = new VectorCache({
  dataDir: './data',
  logger: new Logger('VectorCache', 'debug')
});
```

## Integration Examples

### With MCP Server
```typescript
// In MCP handlers
const cache = new CacheEngine({
  enableVectorCache: true,
  vectorCacheOptions: {
    similarityThreshold: 0.8
  }
});

// Automatic caching in request handling
const cached = await cache.get(prompt, context, model, taskType);
if (cached) {
  return cached.value;
}

// Store response with metadata
const response = await llmProvider.generate(prompt);
await cache.set(prompt, response, {
  model,
  tokens: response.usage.total_tokens,
  taskType
});
```

## Future Enhancements

- **External Embedding Models**: Integration with OpenAI, Cohere, etc.
- **Faiss Integration**: High-performance vector search
- **Distributed Caching**: Redis-based vector storage
- **Real-time Learning**: Adaptive similarity thresholds
- **A/B Testing**: Cache strategy optimization

## Conclusion

The Vector Cache system provides a robust foundation for semantic similarity caching, significantly improving cache hit rates while maintaining response quality. The multi-layer approach ensures both exact and similar queries are efficiently cached, leading to substantial token savings and improved user experience.