import { StreamingService } from '../services/StreamingService.js';
import { CacheEngine } from '../core/CacheEngine.js';
import { Logger } from '../utils/Logger.js';

const logger = new Logger('StreamingDemo');

async function demoStreaming() {
  console.log('🚀 Starting streaming demo...\n');
  
  // Initialize services
  const cacheEngine = new CacheEngine({
    enableVectorCache: true,
    enableHeuristics: true
  });
  
  const streamingService = new StreamingService(cacheEngine);
  
  try {
    // Test 1: Basic streaming
    console.log('📊 Test 1: Basic streaming with Moonshot');
    const requestId = `demo_${Date.now()}`;
    
    const streamingRequest = {
      messages: [
        { role: 'user' as const, content: 'Explain quantum computing in simple terms' }
      ],
      temperature: 0.7,
      max_tokens: 150,
      useCache: true
    };
    
    console.log('Making streaming request...');
    const response = await streamingService.stream(streamingRequest, requestId);
    
    console.log('✅ Streaming completed!');
    console.log(`Response: ${response.content.substring(0, 100)}...`);
    console.log(`Model: ${response.model}`);
    console.log(`Tokens: ${response.usage?.total_tokens || 'N/A'}`);
    console.log(`Duration: ${response.metrics?.duration}ms`);
    console.log(`Tokens/sec: ${response.metrics?.tokens_per_second?.toFixed(2) || 'N/A'}`);
    console.log(`Cached: ${response.cached}\n`);
    
    // Test 2: Cache hit
    console.log('📊 Test 2: Cache hit (should be faster)');
    const cachedResponse = await streamingService.stream(streamingRequest, `demo_${Date.now()}`);
    console.log(`Cached response: ${cachedResponse.cached}`);
    console.log(`Duration: ${cachedResponse.metrics?.duration}ms\n`);
    
    // Test 3: Local model streaming
    console.log('📊 Test 3: Local model streaming (if available)');
    try {
      const localRequest = {
        ...streamingRequest,
        model: 'phi-3-mini-4k-instruct'
      };
      
      const localResponse = await streamingService.stream(localRequest, `local_${Date.now()}`);
      console.log('✅ Local model streaming completed!');
      console.log(`Response: ${localResponse.content.substring(0, 100)}...`);
      console.log(`Model: ${localResponse.model}`);
      console.log(`Duration: ${localResponse.metrics?.duration}ms\n`);
    } catch (error) {
      console.log('⚠️  Local model not available, skipping...\n');
    }
    
    // Test 4: Non-streaming fallback
    console.log('📊 Test 4: Non-streaming fallback');
    const nonStreamingResponse = await streamingService.generate({
      ...streamingRequest,
      model: 'moonshot-v1-8k'
    });
    
    console.log('✅ Non-streaming completed!');
    console.log(`Response: ${nonStreamingResponse.content.substring(0, 100)}...`);
    console.log(`Duration: ${nonStreamingResponse.metrics?.duration}ms\n`);
    
    // Test 5: Health check
    console.log('📊 Test 5: Health check');
    const health = await streamingService.healthCheck();
    console.log('Health status:', JSON.stringify(health, null, 2));
    
    // Test 6: Metrics
    console.log('📊 Test 6: Streaming metrics');
    const metrics = streamingService.getMetrics();
    console.log('Metrics:', JSON.stringify(metrics, null, 2));
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
  } finally {
    await streamingService.cleanup();
    await cacheEngine.close();
    console.log('\n🧹 Cleanup completed');
  }
}

// Run demo if called directly
if (require.main === module) {
  demoStreaming().catch(console.error);
}

export { demoStreaming };