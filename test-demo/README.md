# Demo MCP Token Saver

Esta pasta contém demonstrações práticas das capacidades do MCP Token Saver.

## 📋 O que é o MCP Token Saver?

O MCP Token Saver é um servidor MCP (Model Context Protocol) que otimiza o uso de tokens em chamadas de API de LLM, economizando custos e melhorando a performance através de:

- **Cache inteligente** de respostas frequentes
- **Otimização automática** de prompts
- **Seleção inteligente** de modelos baseado em custo/performance
- **Análise detalhada** de economia de tokens

## 🎯 Demonstrações Disponíveis

### 1. `demo.js` - Exemplo básico
Mostra um exemplo simples de código para análise e otimização.

### 2. `test-token-saver.js` - Teste de ferramentas
Demonstra como usar as ferramentas do MCP programaticamente.

### 3. `interactive-demo.js` - Demo interativa
Apresentação visual das capacidades do sistema.

## 🚀 Como usar as ferramentas do Token Saver

### Ferramentas disponíveis:

1. **smart_moonshot_chat** - Chat inteligente com cache automático
2. **create_smart_cache** - Cria cache inteligente para contextos frequentes
3. **get_savings_stats** - Mostra estatísticas de economia
4. **cache_cleanup** - Limpa cache obsoleto
5. **find_similar_cache** - Busca contextos similares
6. **optimize_prompt** - Otimiza prompts para reduzir tokens
7. **optimize_model_selection** - Seleciona modelo ideal
8. **analyze_cache_efficiency** - Analisa eficiência do cache
9. **get_model_comparison** - Compara modelos disponíveis
10. **execute_smart_optimization** - Otimização completa

## 💡 Exemplos de uso

### Ver estatísticas:
```javascript
use_mcp_tool("token-saver", "get_savings_stats", {"detailed": true})
```

### Otimizar um prompt:
```javascript
use_mcp_tool("token-saver", "optimize_prompt", {
    "prompt": "Seu prompt longo aqui...",
    "target_reduction": 30
})
```

### Criar cache inteligente:
```javascript
use_mcp_tool("token-saver", "create_smart_cache", {
    "system_prompt": "Você é um assistente especializado em...",
    "tag": "analise-codigo-js",
    "ttl": 3600
})
```

## 📊 Benefícios demonstrados

- **Economia de tokens**: Até 30-50% de redução
- **Cache hit rate**: Monitoramento em tempo real
- **Custo reduzido**: Seleção automática de modelos mais econômicos
- **Performance**: Respostas mais rápidas para queries similares

## 🛠️ Configuração

O token-saver já está configurado e funcionando neste ambiente. Para usar em outros projetos:

1. Configure o servidor MCP no `cline_mcp_settings.json`
2. Use as ferramentas via interface do Cline
3. Monitore as economias com as estatísticas fornecidas
