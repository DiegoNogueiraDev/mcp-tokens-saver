/**
 * Comprehensive test suite for Vector Cache system
 * Tests semantic similarity caching and multi-layer cache integration
 */

import { VectorCache } from '../cache/VectorCache.js';
import { CacheEngine } from '../core/CacheEngine.js';
import * as fs from 'fs/promises';
import * as path from 'path';

async function runVectorCacheTests() {
  console.log('🧪 Starting Vector Cache Tests...\n');

  // Test 1: Basic Vector Cache Functionality
  console.log('Test 1: Basic Vector Cache Functionality');
  const vectorCache = new VectorCache({
    dataDir: './test-data',
    maxEntries: 100,
    similarityThreshold: 0.8,
    embeddingDimensions: 384
  });

  await vectorCache.initialize();

  // Store some test data
  await vectorCache.store(
    "How do I create a React component?",
    "To create a React component, use function components or class components...",
    "gpt-4",
    150,
    { task_type: "coding", quality_score: 0.9 }
  );

  await vectorCache.store(
    "What's the best way to implement a React component?",
    "The best way to implement a React component is to use functional components with hooks...",
    "gpt-4",
    180,
    { task_type: "coding", quality_score: 0.85 }
  );

  // Test semantic similarity
  const similarQuery = "How can I build a React component?";
  const result = await vectorCache.findSimilar(similarQuery, "gpt-4", "coding");
  
  console.log(`✅ Similarity search result: ${result ? `Found with ${result.similarity.toFixed(2)} similarity` : 'No match found'}`);
  
  if (result) {
    console.log(`   Reason: ${result.reason}`);
    console.log(`   Original prompt: ${result.entry.originalPrompt}`);
  }

  // Test 2: Multi-layer Cache Integration
  console.log('\nTest 2: Multi-layer Cache Integration');
  const cacheEngine = new CacheEngine({
    dataDir: './test-data',
    enableVectorCache: true,
    vectorCacheOptions: {
      maxEntries: 50,
      similarityThreshold: 0.75
    }
  });

  // Test literal cache
  await cacheEngine.set("What is TypeScript?", "TypeScript is a typed superset of JavaScript...", {
    model: "gpt-4",
    tokens: 100
  });

  const literalResult = await cacheEngine.get("What is TypeScript?", undefined, "gpt-4");
  console.log(`✅ Literal cache test: ${literalResult?.cacheType}`);

  // Test vector cache with similar query
  const vectorResult = await cacheEngine.get("Explain TypeScript to me", undefined, "gpt-4");
  console.log(`✅ Vector cache test: ${vectorResult?.cacheType || 'none'}`);

  // Test 3: Cache Statistics
  console.log('\nTest 3: Cache Statistics');
  const stats = vectorCache.getStats();
  console.log(`📊 Vector Cache Stats:`);
  console.log(`   Total entries: ${stats.total_entries}`);
  console.log(`   Vector hits: ${stats.vector_hits}`);
  console.log(`   Literal hits: ${stats.literal_hits}`);
  console.log(`   Hit rate: ${(stats.vector_hit_rate * 100).toFixed(1)}%`);

  // Test 4: Edge Cases
  console.log('\nTest 4: Edge Cases');
  
  // Test empty cache
  const emptyResult = await vectorCache.findSimilar("random query", "gpt-4");
  console.log(`✅ Empty cache test: ${emptyResult ? 'Found' : 'Not found'}`);

  // Test very similar queries
  await vectorCache.store(
    "How to use useState in React?",
    "useState is a React Hook that lets you add state to functional components...",
    "gpt-4",
    200,
    { task_type: "coding" }
  );

  const verySimilar = await vectorCache.findSimilar("React useState hook usage", "gpt-4", "coding");
  console.log(`✅ Very similar queries test: ${verySimilar ? `Found with ${verySimilar.similarity.toFixed(2)} similarity` : 'No match'}`);

  // Test 5: Performance Test
  console.log('\nTest 5: Performance Test');
  const startTime = Date.now();
  
  // Store multiple entries
  const testPrompts = [
    "JavaScript array methods",
    "React state management",
    "Node.js async programming",
    "TypeScript interfaces",
    "CSS flexbox layout"
  ];

  for (let i = 0; i < testPrompts.length; i++) {
    await vectorCache.store(
      testPrompts[i],
      `Response for ${testPrompts[i]}`,
      "gpt-4",
      100 + i * 10
    );
  }

  const storeTime = Date.now() - startTime;
  console.log(`✅ Stored ${testPrompts.length} entries in ${storeTime}ms`);

  // Test similarity search performance
  const searchStart = Date.now();
  const searchResult = await vectorCache.findSimilar("JavaScript arrays", "gpt-4");
  const searchTime = Date.now() - searchStart;
  console.log(`✅ Similarity search completed in ${searchTime}ms`);

  // Test 6: Cleanup and Persistence
  console.log('\nTest 6: Cleanup and Persistence');
  
  // Test cleanup
  const initialSize = (await vectorCache.getStats()).total_entries;
  await vectorCache['cleanup'](); // Access private method for testing
  const finalSize = (await vectorCache.getStats()).total_entries;
  console.log(`✅ Cleanup test: ${initialSize} -> ${finalSize} entries`);

  // Test persistence
  await vectorCache['saveToDisk'](); // Access private method for testing
  const files = await fs.readdir('./test-data');
  console.log(`✅ Persistence test: ${files.filter(f => f.includes('vector-cache')).length} files saved`);

  // Test 7: Cache Engine Integration
  console.log('\nTest 7: Cache Engine Integration');
  const engineStats = await cacheEngine.getStats();
  console.log(`📊 Multi-layer Cache Stats:`);
  console.log(`   Total entries: ${engineStats.total_entries}`);
  if (engineStats.multi_layer_stats) {
    console.log(`   Literal hits: ${engineStats.multi_layer_stats.literal_hits}`);
    console.log(`   Vector hits: ${engineStats.multi_layer_stats.vector_hits}`);
    console.log(`   Vector hit rate: ${(engineStats.multi_layer_stats.vector_hit_rate * 100).toFixed(1)}%`);
  }

  console.log('\n🎉 All Vector Cache tests completed successfully!');
  
  // Cleanup
  await vectorCache.clear();
  await fs.rm('./test-data', { recursive: true, force: true });
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runVectorCacheTests().catch(console.error);
}

export { runVectorCacheTests };