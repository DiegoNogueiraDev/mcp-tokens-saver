# Local Models Integration Guide

This guide explains how to set up and use local lightweight models (Phi-3-mini and Gemma-2) with MCP Token Saver for zero-cost inference.

## Overview

The MCP Token Saver now supports local model inference using:
- **Phi-3-mini-4k-instruct** (3.8B parameters, ~5.8GB RAM)
- **Gemma-2-2B-IT** (2B parameters, ~4GB RAM)

Both models run via llama.cpp with OpenAI-compatible endpoints.

## Quick Start

### 1. Install llama.cpp

**Linux/macOS:**
```bash
# Ubuntu/Debian
sudo apt install llama.cpp

# macOS
brew install llama.cpp

# From source
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make
```

**Windows:**
Download from [llama.cpp releases](https://github.com/ggerganov/llama.cpp/releases)

### 2. Setup Models

**Automatic Setup:**
```bash
# Linux/macOS
./scripts/setup-local-models.sh

# Windows
scripts\setup-local-models.bat
```

**Manual Setup:**
```bash
# Create models directory
mkdir -p ~/.mcp-tokens-saver/models

# Download Phi-3-mini
wget -O ~/.mcp-tokens-saver/models/phi-3-mini-4k-instruct.Q4_K_M.gguf \
  https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-v0.3-GGUF/resolve/main/phi-3-mini-4k-instruct.Q4_K_M.gguf

# Download Gemma-2
wget -O ~/.mcp-tokens-saver/models/gemma-2-2b-it.Q4_K_M.gguf \
  https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf
```

### 3. Start Models

```bash
# Start Phi-3-mini on port 8080
llama-server -m ~/.mcp-tokens-saver/models/phi-3-mini-4k-instruct.Q4_K_M.gguf -c 4096 -ngl 99 --port 8080

# Start Gemma-2 on port 8081
llama-server -m ~/.mcp-tokens-saver/models/gemma-2-2b-it.Q4_K_M.gguf -c 4096 -ngl 99 --port 8081
```

## Usage

### Basic Integration

```typescript
import { localModelIntegration } from './src/services/LocalModelIntegration.js';

// Initialize
await localModelIntegration.initialize();

// Check available models
const health = await localModelIntegration.getHealthStatus();
console.log('Local models:', health);

// Route request
const routing = await localModelIntegration.routeWithLocalModels('coding', 500);
console.log('Selected:', routing.selectedModel, 'Cost:', routing.estimatedCost);
```

### Advanced Configuration

```typescript
import { LocalModelIntegration } from './src/services/LocalModelIntegration.js';

const integration = new LocalModelIntegration({
  enabled: true,
  autoDetect: true,
  preferredModels: ['phi-3-mini-4k-instruct', 'gemma-2-2b-it'],
  costThreshold: 0.002, // Use local when remote cost > $0.002
  contextThreshold: 1024 // Use local when context > 1024 tokens
});

await integration.initialize();
```

### Cost Analysis

```typescript
const analysis = await integration.getCostAnalysis(
  100, // daily requests
  1000, // average prompt length
  'coding'
);

console.log(`Remote cost: $${analysis.remoteCost.toFixed(4)}`);
console.log(`Local cost: $${analysis.localCost.toFixed(4)}`);
console.log(`Savings: ${analysis.savings.toFixed(2)}%`);
```

## Model Specifications

| Model | Parameters | RAM Usage | Context | Performance | Best For |
|-------|------------|-----------|---------|-------------|----------|
| Phi-3-mini-4k-instruct | 3.8B | ~5.8GB | 4K | 8.5/10 | Coding, Analysis |
| Gemma-2-2B-IT | 2B | ~4GB | 4K | 7.8/10 | Fast responses, Summarization |

## API Endpoints

When running, local models provide OpenAI-compatible endpoints:

- **Phi-3-mini**: `http://localhost:8080/v1`
- **Gemma-2**: `http://localhost:8081/v1`

Example usage:
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "phi-3-mini-4k-instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Configuration

### Environment Variables

```bash
# Enable/disable local models
MCP_LOCAL_MODELS_ENABLED=true

# Cost threshold for local fallback
MCP_LOCAL_COST_THRESHOLD=0.002

# Context threshold for local fallback
MCP_LOCAL_CONTEXT_THRESHOLD=1024
```

### Configuration File

```json
{
  "localModels": {
    "enabled": true,
    "autoDetect": true,
    "preferredModels": ["phi-3-mini-4k-instruct", "gemma-2-2b-it"],
    "costThreshold": 0.002,
    "contextThreshold": 1024
  }
}
```

## Troubleshooting

### Common Issues

1. **llama-server not found**
   ```bash
   # Check installation
   which llama-server
   llama-server --version
   ```

2. **Model download fails**
   ```bash
   # Check internet connection
   curl -I https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-v0.3-GGUF/resolve/main/phi-3-mini-4k-instruct.Q4_K_M.gguf
   ```

3. **Insufficient RAM**
   - Phi-3-mini: Requires ~6GB free RAM
   - Gemma-2: Requires ~4GB free RAM
   - Check with: `free -h` (Linux) or `systeminfo` (Windows)

4. **Port conflicts**
   - Default ports: 8080 (Phi-3), 8081 (Gemma-2)
   - Change ports in setup scripts if needed

### Health Checks

```typescript
// Check model health
const health = await localModelIntegration.getHealthStatus();
for (const h of health) {
  console.log(`${h.model}: ${h.status}`);
}

// Monitor models
await localModelIntegration.monitorModels();
```

## Performance Tips

1. **GPU Acceleration**: Use `-ngl 99` for GPU offloading
2. **CPU Threads**: Use `-t 8` to specify CPU threads
3. **Batch Processing**: Process multiple requests together
4. **Context Caching**: Enable context caching for repeated prompts

## Integration with MCP Token Saver

The local models integrate seamlessly with existing features:

- **Cost-based routing**: Automatically switches to local models when cost exceeds threshold
- **Caching**: Works with existing cache system
- **Monitoring**: Health checks and performance metrics
- **Fallback**: Graceful fallback to remote models if local unavailable

## Security Considerations

- Local models run on your machine - no data leaves your system
- Models are downloaded from trusted sources (Hugging Face)
- API endpoints are local-only (localhost)
- No authentication required for local endpoints

## System Requirements

**Minimum:**
- 4GB RAM (Gemma-2 only)
- 2GB disk space per model
- llama.cpp installed

**Recommended:**
- 8GB RAM (both models)
- 10GB disk space
- GPU with 4GB+ VRAM (optional)
- SSD storage for better performance