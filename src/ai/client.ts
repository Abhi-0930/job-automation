import OpenAI from 'openai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

class DeepSeekService {
  private client: OpenAI | null = null;
  private isQuotaExhausted: boolean = false;

  constructor() {
    if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.trim() !== '') {
      this.client = new OpenAI({
        apiKey: env.DEEPSEEK_API_KEY,
        baseURL: env.DEEPSEEK_BASE_URL,
      });
      logger.info('🧠 DeepSeek AI Client initialized with endpoint %s', env.DEEPSEEK_BASE_URL);
    } else {
      logger.warn('⚠️ DEEPSEEK_API_KEY is not set. DeepSeek AI features will use intelligent local heuristics fallback.');
    }
  }

  public hasApiKey(): boolean {
    return !!this.client && !this.isQuotaExhausted;
  }

  public async chatCompletion(params: {
    systemPrompt: string;
    userPrompt: string;
    jsonResponse?: boolean;
    temperature?: number;
  }): Promise<string | null> {
    if (!this.client || this.isQuotaExhausted) {
      return null;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: params.temperature ?? 0.2,
        response_format: params.jsonResponse ? { type: 'json_object' } : undefined,
      });

      return response.choices[0]?.message?.content || null;
    } catch (error) {
      const errMsg = (error as Error).message;
      if (
        errMsg.includes('402') ||
        errMsg.includes('Insufficient Balance') ||
        errMsg.includes('insufficient_quota') ||
        errMsg.includes('quota')
      ) {
        this.isQuotaExhausted = true;
        logger.warn('⚠️ DeepSeek account balance is insufficient (402). Switched to high-speed local heuristic scoring and rule classifier.');
      } else {
        logger.error('DeepSeek API call failed: %s', errMsg);
      }
      return null;
    }
  }
}

export const deepSeekService = new DeepSeekService();
