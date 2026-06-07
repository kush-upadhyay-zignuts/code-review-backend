import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from '../reviews/reviews.service';
import { UsageService } from '../usage/usage.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly usageService: UsageService,
  ) {}

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser) {
    const [aggregates, languages, monthlyUsed] = await Promise.all([
      this.reviewsService.aggregateUserStats(user.userId),
      this.reviewsService.languageBreakdown(user.userId),
      this.usageService.getMonthlyTokenUsage(user.userId),
    ]);

    const stats = aggregates[0] ?? {
      totalReviews: 0,
      totalTokens: 0,
      avgScore: 0,
      avgResponseTime: 0,
    };

    const monthlyBudget = this.usageService.getMonthlyTokenBudget();

    return {
      totalReviews: stats.totalReviews ?? 0,
      totalTokens: stats.totalTokens ?? 0,
      averageScore: Math.round((stats.avgScore ?? 0) * 10) / 10,
      averageResponseTimeMs: Math.round(stats.avgResponseTime ?? 0),
      monthlyUsed,
      monthlyBudget,
      monthlyRemaining: Math.max(0, monthlyBudget - monthlyUsed),
      topLanguages: languages.map((l) => ({
        language: l._id,
        count: l.count,
      })),
    };
  }
}
