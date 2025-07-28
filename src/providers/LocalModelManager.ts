import { Logger } from '../utils/Logger.js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface LocalModelConfig {
  name: string;
  modelId: string;
  ggufUrl: string;
  ggufFilename: string;
  contextLength: number;
  estimatedRAM: number;
  parameters: string;
  baseUrl: string;
  port: number;
}

export interface ModelStatus {
  name: string;
  isDownloaded: boolean;
  isRunning: boolean;
  health: 'healthy' | 'unhealthy' | 'unknown';
  memoryUsage?: number;
  responseTime?: number;
  lastHealthCheck?: number;
}

export class LocalModelManager {
  private logger: Logger;
  private models: Map<string, LocalModelConfig> = new Map();
  private modelStatuses: Map<string, ModelStatus> = new Map();
  private modelDir: string;
  private serverProcesses: Map<string, any> = new Map();

  constructor() {
    this.logger = new Logger('LocalModelManager');
    this.modelDir = join(homedir(), '.mcp-tokens-saver', 'models');
    
    // Ensure model directory exists
    if (!existsSync(this.modelDir)) {
      mkdirSync(this.modelDir, { recursive: true });
    }

    this.initializeModels();
  }

  private initializeModels(): void {
    // Phi-3-mini-4k-instruct configuration
    this.models.set('phi-3-mini-4k-instruct', {
      name: 'Phi-3-mini-4k-instruct',
      modelId: 'phi-3-mini-4k-instruct',
      ggufUrl: 'https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-v0.3-GGUF/resolve/main/phi-3-mini-4k-instruct.Q4_K_M.gguf',
      ggufFilename: 'phi-3-mini-4k-instruct.Q4_K_M.gguf',
      contextLength: 4096,
      estimatedRAM: 5800, // MB
      parameters: '3.8B',
      baseUrl: 'http://localhost:8080',
      port: 8080
    });

    // Gemma-2-2B-IT configuration
    this.models.set('gemma-2-2b-it', {
      name: 'Gemma-2-2B-IT',
      modelId: 'gemma-2-2b-it',
      ggufUrl: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf',
      ggufFilename: 'gemma-2-2b-it.Q4_K_M.gguf',
      contextLength: 4096,
      estimatedRAM: 4000, // MB
      parameters: '2B',
      baseUrl: 'http://localhost:8081',
      port: 8081
    });

    // Initialize status tracking
    this.models.forEach((config, key) => {
      this.modelStatuses.set(key, {
        name: config.name,
        isDownloaded: false,
        isRunning: false,
        health: 'unknown'
      });
    });

    this.logger.info('Local models initialized', { count: this.models.size });
  }

  /**
   * Get all available local model configurations
   */
  getAvailableModels(): LocalModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * Get model configuration by ID
   */
  getModelConfig(modelId: string): LocalModelConfig | undefined {
    return this.models.get(modelId);
  }

  /**
   * Check if model is downloaded
   */
  isModelDownloaded(modelId: string): boolean {
    const config = this.models.get(modelId);
    if (!config) return false;
    
    const modelPath = join(this.modelDir, config.ggufFilename);
    return existsSync(modelPath);
  }

  /**
   * Download a model if not already present
   */
  async downloadModel(modelId: string): Promise<boolean> {
    const config = this.models.get(modelId);
    if (!config) {
      throw new Error(`Model ${modelId} not found`);
    }

    if (this.isModelDownloaded(modelId)) {
      this.logger.info('Model already downloaded', { modelId });
      return true;
    }

    try {
      this.logger.info('Starting model download', { modelId, url: config.ggufUrl });
      
      // Use wget or curl to download
      const modelPath = join(this.modelDir, config.ggufFilename);
      const command = `wget -O "${modelPath}" "${config.ggufUrl}"`;
      
      execSync(command, { stdio: 'inherit' });
      
      // Verify download
      if (existsSync(modelPath)) {
        this.modelStatuses.set(modelId, {
          ...this.modelStatuses.get(modelId)!,
          isDownloaded: true
        });
        
        this.logger.info('Model downloaded successfully', { modelId, path: modelPath });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to download model', { modelId, error });
      return false;
    }
  }

  /**
   * Start llama.cpp server for a model
   */
  async startModel(modelId: string, gpuLayers: number = 99): Promise<boolean> {
    const config = this.models.get(modelId);
    if (!config) {
      throw new Error(`Model ${modelId} not found`);
    }

    if (!this.isModelDownloaded(modelId)) {
      throw new Error(`Model ${modelId} not downloaded`);
    }

    if (this.serverProcesses.has(modelId)) {
      this.logger.info('Model already running', { modelId });
      return true;
    }

    try {
      const modelPath = join(this.modelDir, config.ggufFilename);
      const command = `llama-server -m "${modelPath}" -c ${config.contextLength} -ngl ${gpuLayers} --port ${config.port}`;
      
      this.logger.info('Starting llama.cpp server', { modelId, command });
      
      // Start the server in background
      const { spawn } = await import('child_process');
      const process = spawn('llama-server', [
        '-m', modelPath,
        '-c', config.contextLength.toString(),
        '-ngl', gpuLayers.toString(),
        '--port', config.port.toString()
      ], {
        detached: true,
        stdio: 'ignore'
      });

      process.unref();
      this.serverProcesses.set(modelId, process);

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if server is responding
      const isHealthy = await this.checkModelHealth(modelId);
      
      if (isHealthy) {
        this.modelStatuses.set(modelId, {
          ...this.modelStatuses.get(modelId)!,
          isRunning: true,
          health: 'healthy'
        });
        
        this.logger.info('Model started successfully', { modelId });
        return true;
      } else {
        this.logger.error('Model failed to start properly', { modelId });
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to start model', { modelId, error });
      return false;
    }
  }

  /**
   * Stop a running model
   */
  async stopModel(modelId: string): Promise<boolean> {
    const process = this.serverProcesses.get(modelId);
    if (!process) {
      this.logger.warn('Model not running', { modelId });
      return true;
    }

    try {
      process.kill('SIGTERM');
      this.serverProcesses.delete(modelId);
      
      this.modelStatuses.set(modelId, {
        ...this.modelStatuses.get(modelId)!,
        isRunning: false,
        health: 'unknown'
      });
      
      this.logger.info('Model stopped', { modelId });
      return true;
    } catch (error) {
      this.logger.error('Failed to stop model', { modelId, error });
      return false;
    }
  }

  /**
   * Check model health via HTTP endpoint
   */
  async checkModelHealth(modelId: string): Promise<boolean> {
    const config = this.models.get(modelId);
    if (!config) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${config.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      this.logger.debug('Health check failed', { modelId, error });
      return false;
    }
  }

  /**
   * Get status of all models
   */
  async getModelStatuses(): Promise<ModelStatus[]> {
    // Update health status for running models
    for (const [modelId, status] of this.modelStatuses.entries()) {
      if (status.isRunning) {
        const isHealthy = await this.checkModelHealth(modelId);
        status.health = isHealthy ? 'healthy' : 'unhealthy';
        status.lastHealthCheck = Date.now();
      }
      
      // Update download status
      status.isDownloaded = this.isModelDownloaded(modelId);
    }

    return Array.from(this.modelStatuses.values());
  }

  /**
   * Auto-detect available local models
   */
  async autoDetectModels(): Promise<string[]> {
    const available: string[] = [];
    
    for (const [modelId, config] of this.models.entries()) {
      if (this.isModelDownloaded(modelId)) {
        available.push(modelId);
      }
    }
    
    return available;
  }

  /**
   * Get recommended model based on available RAM
   */
  getRecommendedModel(availableRAM: number): string | null {
    if (availableRAM >= 6000) {
      return 'phi-3-mini-4k-instruct';
    } else if (availableRAM >= 4000) {
      return 'gemma-2-2b-it';
    }
    return null;
  }

  /**
   * Setup script for downloading required models
   */
  async setupModels(models: string[] = ['phi-3-mini-4k-instruct', 'gemma-2-2b-it']): Promise<void> {
    this.logger.info('Setting up local models', { models });
    
    for (const modelId of models) {
      if (!this.models.has(modelId)) {
        this.logger.warn('Unknown model', { modelId });
        continue;
      }
      
      if (!this.isModelDownloaded(modelId)) {
        await this.downloadModel(modelId);
      }
    }
  }
}