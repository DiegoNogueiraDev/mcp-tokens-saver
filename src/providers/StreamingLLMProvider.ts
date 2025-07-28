import { LLMProvider, ModelPricing } from '../types/index.js';
import { StreamingResponseHandler } from '../handlers/StreamingResponseHandler.js';
import { Logger } from '../utils/Logger.js';

export interface StreamingRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  requestId: string;
}

export interface StreamingResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason?: string;
  model: string;
}

export class StreamingLLMProvider {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('StreamingLLMProvider');
  }

  /**
   * Stream response from any LLM provider
   */
  async streamResponse(
    provider: LLMProvider,
    model: ModelPricing,
    request: StreamingRequest,
    handler: StreamingResponseHandler
  ): Promise<StreamingResponse> {
    handler.startStreaming();

    try {
      if (provider.baseURL.includes('localhost') || provider.baseURL.includes('127.0.0.1')) {
        return await this.streamLocalModel(provider, model, request, handler);
      } else {
        return await this.streamRemoteModel(provider, model, request, handler);
      }
    } catch (error) {
      handler.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Stream from local models (Phi-3, Gemma-2, etc.)
   */
  private async streamLocalModel(
    provider: LLMProvider,
    model: ModelPricing,
    request: StreamingRequest,
    handler: StreamingResponseHandler
  ): Promise<StreamingResponse> {
    const url = `${provider.baseURL}/chat/completions`;
    
    const payload = {
      model: model.name,
      messages: request.messages,
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 2048,
      stream: true
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Local model API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body from local model');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              const finalResponse = handler.completeStreaming({
                model: model.name,
                usage: {
                  prompt_tokens: 0, // Local models might not provide usage
                  completion_tokens: handler.getResponse().length,
                  total_tokens: 0
                },
                finish_reason: 'stop'
              });
              
              return {
                content: finalResponse,
                model: model.name
              };
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              
              if (delta) {
                handler.processToken(delta);
              }
            } catch (parseError) {
              this.logger.warn('Failed to parse streaming data', parseError);
            }
          }
        }
      }

      // Handle case where stream ends without [DONE]
      const finalResponse = handler.completeStreaming({
        model: model.name,
        usage: {
          prompt_tokens: 0,
          completion_tokens: handler.getResponse().length,
          total_tokens: 0
        },
        finish_reason: 'stop'
      });

      return {
        content: finalResponse,
        model: model.name
      };

    } catch (error) {
      this.logger.error('Error streaming from local model', error);
      throw error;
    }
  }

  /**
   * Stream from remote APIs (OpenAI, Moonshot, etc.)
   */
  private async streamRemoteModel(
    provider: LLMProvider,
    model: ModelPricing,
    request: StreamingRequest,
    handler: StreamingResponseHandler
  ): Promise<StreamingResponse> {
    const url = `${provider.baseURL}/chat/completions`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API keys based on provider
    if (provider.name === 'Moonshot AI' && process.env.MOONSHOT_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.MOONSHOT_API_KEY}`;
    } else if (provider.name === 'OpenAI' && process.env.OPENAI_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
    } else if (provider.name === 'Anthropic' && process.env.ANTHROPIC_API_KEY) {
      headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
      headers['anthropic-version'] = '2023-06-01';
    }

    const payload = {
      model: model.name,
      messages: request.messages,
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 2048,
      stream: true
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from API');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: StreamingResponse['usage'] = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      };
      let finish_reason: string = 'stop';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              const finalResponse = handler.completeStreaming({
                model: model.name,
                usage,
                finish_reason
              });
              
              return {
                content: finalResponse,
                usage,
                finish_reason,
                model: model.name
              };
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle different response formats
              if (provider.name === 'Anthropic') {
                // Anthropic uses different format
                const delta = parsed.delta?.text;
                if (delta) {
                  handler.processToken(delta);
                }
                
                if (parsed.usage) {
                  usage = {
                    prompt_tokens: parsed.usage.input_tokens || 0,
                    completion_tokens: parsed.usage.output_tokens || 0,
                    total_tokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0)
                  };
                }
                
                if (parsed.stop_reason) {
                  finish_reason = parsed.stop_reason;
                }
              } else {
                // OpenAI/Moonshot format
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  handler.processToken(delta);
                }
                
                if (parsed.usage) {
                  usage = {
                    prompt_tokens: parsed.usage.prompt_tokens || 0,
                    completion_tokens: parsed.usage.completion_tokens || 0,
                    total_tokens: parsed.usage.total_tokens || 0
                  };
                }
                
                if (parsed.choices?.[0]?.finish_reason) {
                  finish_reason = parsed.choices[0].finish_reason;
                }
              }
            } catch (parseError) {
              this.logger.warn('Failed to parse streaming data', parseError);
            }
          }
        }
      }

      // Handle case where stream ends without [DONE]
      const finalResponse = handler.completeStreaming({
        model: model.name,
        usage,
        finish_reason: finish_reason || 'stop'
      });

      return {
        content: finalResponse,
        usage,
        finish_reason,
        model: model.name
      };

    } catch (error) {
      this.logger.error('Error streaming from remote API', error);
      throw error;
    }
  }

  /**
   * Non-streaming fallback for backward compatibility
   */
  async generateResponse(
    provider: LLMProvider,
    model: ModelPricing,
    request: Omit<StreamingRequest, 'requestId' | 'stream'>
  ): Promise<StreamingResponse> {
    const url = `${provider.baseURL}/chat/completions`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API keys based on provider
    if (provider.name === 'Moonshot AI' && process.env.MOONSHOT_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.MOONSHOT_API_KEY}`;
    } else if (provider.name === 'OpenAI' && process.env.OPENAI_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
    } else if (provider.name === 'Anthropic' && process.env.ANTHROPIC_API_KEY) {
      headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
      headers['anthropic-version'] = '2023-06-01';
    }

    const payload = {
      model: model.name,
      messages: request.messages,
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 2048,
      stream: false
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      let content: string;
      let usage: StreamingResponse['usage'];
      
      if (provider.name === 'Anthropic') {
        content = data.content?.[0]?.text || '';
        usage = {
          prompt_tokens: data.usage?.input_tokens || 0,
          completion_tokens: data.usage?.output_tokens || 0,
          total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        };
      } else {
        content = data.choices?.[0]?.message?.content || '';
        usage = {
          prompt_tokens: data.usage?.prompt_tokens || 0,
          completion_tokens: data.usage?.completion_tokens || 0,
          total_tokens: data.usage?.total_tokens || 0
        };
      }

      return {
        content,
        usage,
        model: model.name
      };

    } catch (error) {
      this.logger.error('Error generating response', error);
      throw error;
    }
  }
}