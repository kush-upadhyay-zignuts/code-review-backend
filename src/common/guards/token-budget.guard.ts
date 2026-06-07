import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsageService } from '../../modules/usage/usage.service';
import { AuthUser } from '../decorators/current-user.decorator';

function getReviewPayload(request: Request): {
  code: string;
  language: string;
} {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null) {
    return { code: '', language: '' };
  }
  const record = body as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : '',
    language: typeof record.language === 'string' ? record.language : '',
  };
}

function estimateTokens(code: string, language: string): number {
  return Math.ceil((code.length + language.length) / 4) + 500;
}

@Injectable()
export class TokenBudgetGuard implements CanActivate {
  constructor(private readonly usageService: UsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthUser }>();
    const userId = request.user.userId;
    const { code, language } = getReviewPayload(request);
    const estimated = estimateTokens(code, language);

    const allowed = await this.usageService.checkTokenBudget(userId, estimated);
    if (!allowed) {
      const used = await this.usageService.getMonthlyTokenUsage(userId);
      const budget = this.usageService.getMonthlyTokenBudget();

      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: `Monthly token budget exceeded. Used ${used}/${budget} tokens.`,
          error: 'Token Budget Exceeded',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}
