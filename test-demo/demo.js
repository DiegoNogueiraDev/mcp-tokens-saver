// Demo do MCP Token Saver
// Exemplo prático de otimização de tokens

console.log('=== Demo MCP Token Saver ===\n');

// Exemplo 1: Otimização de prompt
const exemploCodigo = `
function calcularFatorial(n) {
    if (n === 0 || n === 1) {
        return 1;
    }
    let resultado = 1;
    for (let i = 2; i <= n; i++) {
        resultado *= i;
    }
    return resultado;
}
`;

console.log('📊 Exemplo de código para análise:');
console.log(exemploCodigo);

// Vamos simular uma análise de código usando o token-saver
const promptAnalise = `
Analise este código JavaScript e forneça:
1. Complexidade temporal
2. Possíveis otimizações
3. Bugs potenciais
4. Melhorias de legibilidade

Código: ${exemploCodigo}
`;

console.log('📝 Prompt original:', promptAnalise.length, 'caracteres');
