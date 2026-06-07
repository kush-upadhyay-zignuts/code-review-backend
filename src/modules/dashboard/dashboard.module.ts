import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { ReviewsModule } from '../reviews/reviews.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [ReviewsModule, UsageModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
