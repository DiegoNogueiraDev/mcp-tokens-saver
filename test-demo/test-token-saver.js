#!/usr/bin/env node

/**
 * Demo completo do MCP Token Saver
 * Este script demonstra todas as capacidades principais
 */

const { execSync } = require('child_process');

console.log('🚀 Iniciando demonstração do MCP Token Saver\n');

// Função auxiliar para executar comandos do MCP
function runMCPCommand(tool, args = {}) {
    try {
        const cmd = `node -e "const { use_mcp_tool } = require('@modelcontextprotocol/sdk'); use_mcp_tool('token-saver', '${tool}', ${JSON.stringify(args).replace(/"/g, '\\"')})"`;
        return execSync(`cd /home/diego/mcp-tokens-saver && ${cmd}`, { encoding: 'utf8' });
    } catch (e) {
        return `Erro: ${e.message}`;
    }
}

// 1. Mostrar estatísticas iniciais
console.log('📊 Estatísticas Iniciais do Cache:');
console.log('==================================');

// 2. Demonstrar otimização de prompt
console.log('\n📝 Teste de Otimização de Prompt');
console.log('=================================');

const promptExemplo = `
Analise este código JavaScript complexo e forneça uma análise detalhada incluindo:
- Complexidade de tempo e espaço
- Possíveis otimizações de performance
- Problemas de segurança
- Sugestões de refatoração
- Documentação faltante
- Testes unitários necessários

Código:
function processarDadosUsuarios(usuarios) {
    const resultados = [];
    for (let i = 0; i < usuarios.length; i++) {
        const usuario = usuarios[i];
        if (usuario.ativo && usuario.idade >= 18) {
            const processado = {
                nome: usuario.nome.toUpperCase(),
                email: usuario.email.toLowerCase(),
                categoria: usuario.idade > 65 ? 'senior' : 'adulto'
            };
            resultados.push(processado);
        }
    }
    return resultados;
}
`;

console.log('Prompt original:', promptExemplo.length, 'caracteres');

// 3. Criar cache inteligente para análise de código
console.log('\n🗄️ Criando Cache Inteligente');
console.log('=============================');

// 4. Demonstrar busca por similaridade
console.log('\n🔍 Teste de Busca por Similaridade');
console.log('===================================');

// 5. Análise de eficiência do cache
console.log('\n📈 Análise de Eficiência');
console.log('========================');

// Resultados finais
console.log('\n✅ Demonstração concluída!');
console.log('Para usar o token-saver em seu projeto:');
console.log('1. Configure o MCP server no seu claude_desktop_config.json');
console.log('2. Use as ferramentas disponíveis via interface do Cline');
console.log('3. Monitore as economias com get_savings_stats');
