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

function estimateTokens(code: string): number {
  const lines = code.split('\n').length;
  const inputEstimate = Math.ceil(code.length / 4);
  const outputEstimate =
    lines <= 40 ? 1_200 : lines <= 100 ? 1_800 : lines <= 200 ? 2_500 : 3_500;
  return inputEstimate + outputEstimate + 400;
}

@Injectable()
export class TokenBudgetGuard implements CanActivate {
  constructor(private readonly usageService: UsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthUser }>();
    const userId = request.user.userId;
    const { code } = getReviewPayload(request);
    const estimated = estimateTokens(code);

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
