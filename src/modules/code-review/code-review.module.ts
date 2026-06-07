import { Module } from '@nestjs/common';
import { CodeReviewService } from './code-review.service';
import { IssueValidatorService } from './issue-validator.service';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [UsageModule],
  providers: [CodeReviewService, IssueValidatorService],
  exports: [CodeReviewService],
})
export class CodeReviewModule {}
