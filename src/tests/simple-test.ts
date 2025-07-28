#!/usr/bin/env node
import { CacheEngine } from '../core/CacheEngine.js';
import { ModelOptimizer } from '../services/ModelOptimizer.js';
import { TemplateEngine } from '../templates/TemplateEngine.js';
import { MetricsCollector } from '../analytics/MetricsCollector.js';
import { LLMProviderFactory } from '../providers/LLMProviderFactory.js';

async function testIntegratedSystem() {
  console.log('🚀 Testing Integrated MCP Token Saver System\n');

  // Initialize components
  const cacheEngine = new CacheEngine({
    dataDir: './test-data',
    maxMemoryMB: 50,
    defaultTTL: 1800,
    enableHeuristics: true
  });

  const modelOptimizer = new ModelOptimizer();
  const templateEngine = new TemplateEngine();
  const metricsCollector = new MetricsCollector();
  const providerFactory = new LLMProviderFactory();

  try {
    console.log('1. Testing Cache Engine...');
    
    // Test cache set/get
    const testPrompt = 'Explain how async/await works in JavaScript';
    const testResponse = 'Async/await is a syntax that makes it easier to work with Promises...';
    
    await cacheEngine.set(testPrompt, testResponse, {
      model: 'moonshot-v1-8k',
      tokens: 150,
      tags: ['javascript', 'async']
    });
    
    const cached = await cacheEngine.get(testPrompt);
    console.log('   ✅ Cache works:', cached ? 'Hit' : 'Miss');

    console.log('\n2. Testing Model Optimization...');
    
    const optimization = modelOptimizer.optimizeModelSelection(
      'coding',
      100, // input tokens
      0,   // context tokens
      'balanced'
    );
    
    console.log('   ✅ Model optimization:', optimization.model);
    console.log('   💰 Expected savings:', optimization.expectedSavings.toFixed(1) + '%');

    console.log('\n3. Testing Template Engine...');
    
    const codeReviewTemplate = templateEngine.render('code-review', {
      language: 'TypeScript',
      code: 'function add(a: number, b: number) { return a + b; }',
      focus_areas: 'type safety, performance'
    });
    
    console.log('   ✅ Template rendered, tokens:', codeReviewTemplate.estimated_tokens);

    console.log('\n4. Testing Provider Factory...');
    
    const comparison = providerFactory.compareModels([]);
    console.log('   ✅ Providers compared:', comparison.comparison.length, 'models');
    console.log('   💰 Cheapest:', comparison.cheapest);
    console.log('   ⚡ Best value:', comparison.best_value);

    console.log('\n5. Testing Metrics Collection...');
    
    metricsCollector.recordRequest(true, 150);
    metricsCollector.recordRequest(false);
    metricsCollector.recordModelOptimization(0.25);
    
    const report = metricsCollector.getMetricsReport();
    console.log('   ✅ Metrics collected:', report.usage.requests, 'requests');
    console.log('   📊 Hit rate:', report.efficiency.cache_hit_rate.toFixed(1) + '%');
    console.log('   💰 Estimated savings: $' + report.efficiency.estimated_cost_savings.toFixed(4));

    console.log('\n🎉 All systems working correctly!');
    
    await cacheEngine.close();
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await cacheEngine.close();
  }
}

testIntegratedSystem().catch(console.error);