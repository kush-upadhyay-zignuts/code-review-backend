import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.BACKEND_PORT ?? process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  apiPrefix: process.env.API_PREFIX ?? 'api',
}));

export const databaseConfig = registerAs('database', () => ({
  url:
    process.env.MONGODB_URL ??
    process.env.DATABASE_URL ??
    'mongodb://localhost:27017/code_review',
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production',
  expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? '',
}));

export const aiConfig = registerAs('ai', () => ({
  apiKey: process.env.AI_API_KEY ?? '',
  baseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  model: process.env.AI_MODEL ?? 'gpt-4o-mini',
  maxOutputTokens: parseInt(process.env.AI_MAX_OUTPUT_TOKENS ?? '8192', 10),
  validatorEnabled: process.env.AI_VALIDATOR_ENABLED ?? 'true',
  minConfidence: parseInt(process.env.AI_MIN_CONFIDENCE ?? '80', 10),
}));

export const usageConfig = registerAs('usage', () => ({
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '10', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  monthlyTokenBudget: parseInt(
    process.env.MONTHLY_TOKEN_BUDGET ?? '100000',
    10,
  ),
}));

export const emailConfig = registerAs('email', () => ({
  user: process.env.EMAIL_USER ?? '',
  pass: process.env.EMAIL_PASS ?? '',
  host: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT ?? '587', 10),
  frontendUrl:
    process.env.FRONTEND_URL ??
    process.env.CORS_ORIGIN ??
    'http://localhost:3000',
}));
