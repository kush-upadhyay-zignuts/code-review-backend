import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { RedisService } from '../services/redis.service';
import { UsageService } from '../../modules/usage/usage.service';
import { AuthUser } from '../decorators/current-user.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redisService: RedisService,
    private readonly usageService: UsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const userId = request.user.userId;
    const windowMs = this.usageService.getRateLimitWindowMs();
    const max = this.usageService.getRateLimitMax();

    const { count, resetAt } = await this.redisService.incrementRateLimit(
      `rate:${userId}`,
      windowMs,
    );

    if (count > max) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          error: 'Too Many Requests',
          resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
