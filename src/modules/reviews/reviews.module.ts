import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { CodeReviewModule } from '../code-review/code-review.module';
import { UsageModule } from '../usage/usage.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Review, ReviewSchema } from './schemas/review.schema';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { TokenBudgetGuard } from '../../common/guards/token-budget.guard';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
    CodeReviewModule,
    UsageModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService, RateLimitGuard, TokenBudgetGuard],
  exports: [ReviewsService],
})
export class ReviewsModule {}
