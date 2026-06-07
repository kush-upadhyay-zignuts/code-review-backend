import { Body, Controller, Get, Patch } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { ReviewsService } from '../reviews/reviews.service';
import { UsageService } from '../usage/usage.service';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { ConfigService } from '@nestjs/config';

@Controller('admin')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly usageService: UsageService,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @Get('analytics')
  async analytics() {
    const [globalStats, tokenStats, userCount] = await Promise.all([
      this.reviewsService.globalStats(),
      this.usageService.globalTokenUsage(),
      this.userModel.countDocuments(),
    ]);

    const reviews = globalStats[0] ?? {};
    const tokens = tokenStats[0] ?? {};

    return {
      totalUsers: userCount,
      totalReviews: reviews.totalReviews ?? 0,
      totalTokens: tokens.totalTokens ?? 0,
      totalInputTokens: tokens.totalInput ?? 0,
      totalOutputTokens: tokens.totalOutput ?? 0,
      averageScore: Math.round((reviews.avgScore ?? 0) * 10) / 10,
      averageResponseTimeMs: Math.round(reviews.avgResponseTime ?? 0),
      rateLimitMax: this.usageService.getRateLimitMax(),
      monthlyTokenBudget: this.usageService.getMonthlyTokenBudget(),
      redisEnabled: Boolean(this.configService.get<string>('redis.url')),
    };
  }

  @Patch('rate-limits')
  updateRateLimits(
    @Body() body: { rateLimitMax?: number; monthlyTokenBudget?: number },
  ) {
    return {
      message: 'Restart server with updated env vars to apply permanently',
      current: {
        rateLimitMax: this.usageService.getRateLimitMax(),
        monthlyTokenBudget: this.usageService.getMonthlyTokenBudget(),
      },
      requested: body,
    };
  }
}
