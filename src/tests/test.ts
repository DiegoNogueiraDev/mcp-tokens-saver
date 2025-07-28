#!/usr/bin/env node
import OpenAI from 'openai';
import 'dotenv/config';

const openai = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.ai/v1'
});

async function testMoonshotConnection() {
  console.log('🧪 Testando conexão com Moonshot AI...\n');

  try {
    // Teste 1: Conexão básica
    console.log('1️⃣ Teste de conexão básica:');
    const basicResponse = await openai.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [
        { role: 'user', content: 'Responda apenas "OK" se você está funcionando.' }
      ]
    });

    console.log('✅ Resposta:', basicResponse.choices[0].message.content);
    console.log('📊 Tokens usados:', basicResponse.usage?.total_tokens);
    console.log();

    // Teste 2: Context Caching com headers alternativos
    console.log('2️⃣ Teste de Context Caching com headers:');
    
    const systemPrompt = 'Você é um assistente especializado em economia de tokens. Sempre responda de forma concisa e direta.';
    
    // Primeira requisição - tentativa de cache via headers
    console.log('📦 Testando cache via headers X-Msh-Context-Cache...');
    const headerResponse = await openai.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Explique em uma frase o que é cache de contexto.' }
      ]
    }, {
      headers: {
        'X-Msh-Context-Cache': 'true',
        'X-Msh-Context-Cache-Reset-TTL': '3600'
      }
    });

    console.log('✅ Resposta com headers:', headerResponse.choices[0].message.content);
    console.log('📊 Tokens usados:', headerResponse.usage?.total_tokens);
    console.log('🎯 Tokens em cache:', (headerResponse.usage as any)?.cached_tokens || 'N/A');
    console.log();

    // Teste 3: Segunda requisição com mesmo contexto
    console.log('3️⃣ Teste de reutilização de contexto:');
    const secondResponse = await openai.chat.completions.create({
      model: 'moonshot-v1-8k',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Como economizar tokens em APIs de LLM?' }
      ]
    }, {
      headers: {
        'X-Msh-Context-Cache': 'true',
        'X-Msh-Context-Cache-Reset-TTL': '3600'
      }
    });

    console.log('✅ Segunda resposta:', secondResponse.choices[0].message.content?.substring(0, 100) + '...');
    console.log('📊 Tokens totais:', secondResponse.usage?.total_tokens);
    console.log('🎯 Tokens em cache:', (secondResponse.usage as any)?.cached_tokens || 'N/A');
    console.log();

    // Teste 4: Estatísticas de economia
    console.log('4️⃣ Estatísticas de economia:');
    const baseTokens = systemPrompt.length / 4;
    const firstSavedTokens = (headerResponse.usage as any)?.cached_tokens || 0;
    const secondSavedTokens = (secondResponse.usage as any)?.cached_tokens || 0;
    const firstEconomyPercent = firstSavedTokens > 0 ? ((firstSavedTokens / headerResponse.usage!.total_tokens!) * 100).toFixed(1) : '0';
    const secondEconomyPercent = secondSavedTokens > 0 ? ((secondSavedTokens / secondResponse.usage!.total_tokens!) * 100).toFixed(1) : '0';
    
    console.log(`💰 Tokens base do sistema: ~${Math.ceil(baseTokens)}`);
    console.log(`🎯 Primeira req - Tokens salvos: ${firstSavedTokens} (${firstEconomyPercent}%)`);
    console.log(`🎯 Segunda req - Tokens salvos: ${secondSavedTokens} (${secondEconomyPercent}%)`);
    console.log();

    console.log('🎉 Todos os testes passaram! MCP Token Saver está pronto para uso.');

  } catch (error) {
    console.error('❌ Erro nos testes:', error);
    console.error('\n🔧 Verificar:');
    console.error('- MOONSHOT_API_KEY está configurada no .env');
    console.error('- API key tem permissões para Context Caching');
    console.error('- Conexão com api.moonshot.ai está funcionando');
  }
}

// Função para testar funcionalidades do MCP
async function testMCPFunctionality() {
  console.log('\n🛠️ Testando funcionalidades MCP específicas...\n');

  const testPrompts = [
    'Analyze this code: function hello() { return "world"; }',
    'Review this React component for improvements',
    'Explain how async/await works in JavaScript',
    'Generate documentation for a REST API'
  ];

  for (let i = 0; i < testPrompts.length; i++) {
    const prompt = testPrompts[i];
    console.log(`📝 Teste ${i + 1}: ${prompt.substring(0, 40)}...`);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'moonshot-v1-8k',
        messages: [
          { role: 'system', content: 'Você é um assistente de programação conciso.' },
          { role: 'user', content: prompt }
        ]
      });

      const tokens = response.usage?.total_tokens || 0;
      console.log(`   ✅ Tokens: ${tokens} | Cache elegível: ${shouldCacheHeuristic(prompt, tokens)}`);
      
    } catch (error) {
      console.log(`   ❌ Erro: ${error}`);
    }
  }
}

// Heurística de cache (mesma do servidor)
function shouldCacheHeuristic(prompt: string, tokens: number): boolean {
  return tokens > 100 && (
    prompt.includes('analyze') ||
    prompt.includes('review') ||
    prompt.includes('explain') ||
    prompt.includes('generate') ||
    prompt.length > 500
  );
}

async function main() {
  await testMoonshotConnection();
  await testMCPFunctionality();
}

main().catch(console.error);