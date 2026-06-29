import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

function isPlaceholderApiKey(apiKey: string): boolean {
  return (
    !apiKey ||
    apiKey.includes('your_openai_api_key') ||
    apiKey.includes('your_openrouter_api_key')
  );
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('openrouter.ai');
}

/** Normalize shorthand model names for OpenRouter (e.g. gpt-oss-20b → openai/gpt-oss-20b). */
export function resolveAiModel(
  model: string | undefined,
  baseUrl: string,
): string {
  const trimmed = model?.trim() || 'openai/gpt-oss-20b:free';

  if (isOpenRouterBaseUrl(baseUrl) && !trimmed.includes('/')) {
    return `openai/${trimmed}`;
  }

  return trimmed;
}

export function createAiClient(
  configService: ConfigService,
): OpenAI | null {
  const apiKey = configService.get<string>('ai.apiKey')?.trim();
  if (!apiKey || isPlaceholderApiKey(apiKey)) {
    return null;
  }

  const baseURL =
    configService.get<string>('ai.baseUrl')?.trim() ||
    'https://openrouter.ai/api/v1';

  const defaultHeaders: Record<string, string> = {};
  if (isOpenRouterBaseUrl(baseURL)) {
    defaultHeaders['HTTP-Referer'] =
      configService.get<string>('ai.appUrl') ?? 'http://localhost:3000';
    defaultHeaders['X-OpenRouter-Title'] =
      configService.get<string>('ai.appName') ?? 'CodeReview AI';
  }

  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders,
  });
}

export function getAiModel(configService: ConfigService): string {
  const baseUrl =
    configService.get<string>('ai.baseUrl')?.trim() ||
    'https://openrouter.ai/api/v1';

  return resolveAiModel(configService.get<string>('ai.model'), baseUrl);
}
