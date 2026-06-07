import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly memoryStore = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('redis.url');
    if (redisUrl) {
      this.client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
      this.client.on('error', (error) => {
        this.logger.warn(`Redis error: ${error.message}`);
      });
      this.logger.log('Redis connected for rate limiting');
    } else {
      this.logger.log(
        'Using in-memory rate limiting (set REDIS_URL for production)',
      );
    }
  }

  isRedisEnabled(): boolean {
    return this.client !== null;
  }

  async incrementRateLimit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }> {
    if (this.client) {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.pexpire(key, windowMs);
      }
      const ttl = await this.client.pttl(key);
      return { count, resetAt: Date.now() + Math.max(ttl, 0) };
    }

    const now = Date.now();
    const existing = this.memoryStore.get(key);
    if (!existing || existing.resetAt <= now) {
      const entry = { count: 1, resetAt: now + windowMs };
      this.memoryStore.set(key, entry);
      return entry;
    }

    existing.count += 1;
    this.memoryStore.set(key, existing);
    return existing;
  }

  onModuleDestroy() {
    void this.client?.quit();
  }
}
