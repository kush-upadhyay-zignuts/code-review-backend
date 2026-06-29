import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { TokenBudgetGuard } from '../../common/guards/token-budget.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { UsageService } from '../usage/usage.service';
import { CodeReviewService } from '../code-review/code-review.service';
import { CreateCodeReviewDto } from '../code-review/dto/create-code-review.dto';
import { ReviewsService } from './reviews.service';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import {
  CodeReviewIssue,
  CodeReviewSummary,
} from '../code-review/interfaces/code-review.interface';
import { ReviewResultPayload } from './schemas/review.schema';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly codeReviewService: CodeReviewService,
    private readonly reviewsService: ReviewsService,
    private readonly usageService: UsageService,
    private readonly rateLimitGuard: RateLimitGuard,
    private readonly tokenBudgetGuard: TokenBudgetGuard,
  ) {}

  @Get()
  history(@CurrentUser() user: AuthUser, @Query() query: ListReviewsQueryDto) {
    return this.reviewsService.findByUserPaginated(
      user.userId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Post('stream')
  @UseGuards(RateLimitGuard, TokenBudgetGuard)
  async stream(
    @Body() dto: CreateCodeReviewDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    return this.executeStream(dto, user, res);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const review = await this.reviewsService.findByIdForUser(id, user.userId);
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.reviewsService.deleteForUser(id, user.userId);
    return { success: true };
  }

  @Post(':id/rerun')
  async rerun(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const existing = await this.reviewsService.findByIdForUser(id, user.userId);
    if (!existing) throw new NotFoundException('Review not found');

    const dto: CreateCodeReviewDto = {
      code: existing.code,
      language: existing.language as CreateCodeReviewDto['language'],
    };

    const fakeContext = {
      switchToHttp: () => ({
        getRequest: () => ({ user, body: dto }),
      }),
    };

    await this.rateLimitGuard.canActivate(fakeContext as never);
    await this.tokenBudgetGuard.canActivate(fakeContext as never);

    return this.executeStream(dto, user, res);
  }

  private async executeStream(
    dto: CreateCodeReviewDto,
    user: AuthUser,
    res: Response,
  ): Promise<void> {
    const startedAt = Date.now();
    const pending = await this.reviewsService.createPending(
      user.userId,
      dto.language ?? 'auto',
      dto.code,
    );

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (type: string, data: Record<string, unknown>) => {
      if (res.writableEnded) return;
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      const flushable = res as Response & { flush?: () => void };
      flushable.flush?.();
    };

    const issues: CodeReviewIssue[] = [];
    let summary: CodeReviewSummary | null = null;

    try {
      writeEvent('review', { reviewId: pending._id.toString() });

      const generator = this.codeReviewService.reviewStream(dto);
      let result = await generator.next();

      while (!result.done) {
        const event = result.value;
        if (event.type === 'issue') {
          issues.push(event.data as unknown as CodeReviewIssue);
        }
        if (event.type === 'summary') {
          summary = event.data as unknown as CodeReviewSummary;
        }
        writeEvent(event.type, event.data);
        result = await generator.next();
      }

      const usage = result.value ?? {
        inputTokens: 0,
        outputTokens: 0,
        tokensUsed: 0,
      };

      if (usage.tokensUsed > 0) {
        await this.usageService.recordTokenUsage(
          user.userId,
          usage.inputTokens,
          usage.outputTokens,
        );
      }

      const resultPayload: ReviewResultPayload = {
        summary: summary?.summary ?? '',
        overallScore: summary?.overallScore ?? 0,
        metrics: summary?.metrics ?? {
          codeQualityScore: 0,
          securityScore: 0,
          maintainabilityScore: 0,
        },
        issues: issues.map((i) => ({
          title: i.title,
          category: i.category,
          type: i.type,
          severity: i.severity,
          line: i.line,
          explanation: i.explanation,
          message: i.message,
          evidence: i.evidence,
          suggestedFix: i.suggestedFix,
          suggestion: i.suggestion,
          confidence: i.confidence,
        })),
      };

      await this.reviewsService.saveResult(
        pending._id.toString(),
        resultPayload,
        {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.tokensUsed,
          responseTimeMs: Date.now() - startedAt,
        },
      );

      const monthlyUsed = await this.usageService.getMonthlyTokenUsage(
        user.userId,
      );
      const monthlyBudget = this.usageService.getMonthlyTokenBudget();

      writeEvent('token', {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        used: usage.tokensUsed,
        monthlyUsed,
        monthlyBudget,
        monthlyRemaining: Math.max(0, monthlyBudget - monthlyUsed),
      });

      writeEvent('done', { reviewId: pending._id.toString() });
    } catch (error) {
      writeEvent('error', {
        message: error instanceof Error ? error.message : 'Stream failed',
      });
    } finally {
      res.end();
    }
  }
}
