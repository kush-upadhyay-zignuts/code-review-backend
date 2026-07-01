import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildStructuredReviewPrompt,
  SYSTEM_PROMPT,
} from './prompts/code-review.prompt';
import { createAiClient, getAiModel, isOpenRouter } from './ai-openai-client';
import { CreateCodeReviewDto } from './dto/create-code-review.dto';
import {
  normalizeDetectedLanguage,
  resolveMaxOutputTokens,
} from './language-utils';
import { normalizeReviewIssue } from './issue-normalizer';
import { processIssues } from './issue-processor';
import {
  CodeReviewIssue,
  CodeReviewMetrics,
  CodeReviewSummary,
  StreamEvent,
  TokenUsageResult,
} from './interfaces/code-review.interface';
import { IssueValidatorService } from './issue-validator.service';
import OpenAI from 'openai';

const PHASES = [
  'analyzing_syntax',
  'checking_security',
  'checking_performance',
  'checking_style',
  'validating_findings',
] as const;

const ISSUE_STREAM_DELAY_MS = 200;

@Injectable()
export class CodeReviewService {
  private readonly logger = new Logger(CodeReviewService.name);
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly minConfidence: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly issueValidator: IssueValidatorService,
  ) {
    this.model = getAiModel(this.configService);
    this.maxOutputTokens = this.configService.get<number>(
      'ai.maxOutputTokens',
      8192,
    );
    this.minConfidence =
      this.configService.get<number>('ai.minConfidence') ?? 80;
  }

  async *reviewStream(
    dto: CreateCodeReviewDto,
  ): AsyncGenerator<StreamEvent, TokenUsageResult> {
    const openai = createAiClient(this.configService);
    if (!openai) {
      yield {
        type: 'error',
        data: {
          message:
            'AI API key is missing or invalid. Set AI_API_KEY in code-review-backend/.env and restart.',
        },
      };
      return { inputTokens: 0, outputTokens: 0, tokensUsed: 0 };
    }

    for (const phase of PHASES.slice(0, 4)) {
      yield { type: 'phase', data: { phase, status: 'started' } };
    }

    const prompt = buildStructuredReviewPrompt(dto.code, dto.language ?? 'auto');
    const outputTokenLimit = resolveMaxOutputTokens(dto.code, this.maxOutputTokens);
    let inputTokens = 0;
    let outputTokens = 0;
    let jsonBuffer = '';

    try {
      const stream = await this.createReviewStream(openai, prompt, outputTokenLimit);

      for await (const chunk of stream) {
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }

        const content = chunk.choices[0]?.delta?.content ?? '';
        if (!content) continue;

        yield { type: 'text', data: { content } };
        jsonBuffer += content;
      }

      for (const phase of PHASES.slice(0, 4)) {
        yield { type: 'phase', data: { phase, status: 'complete' } };
      }

      yield {
        type: 'phase',
        data: { phase: 'validating_findings', status: 'started' },
      };

      const parsed = this.tryParseJsonObject(jsonBuffer.trim());
      if (!parsed) {
        yield {
          type: 'error',
          data: {
            message:
              'Failed to parse AI review response as JSON. Try again or use a shorter code snippet.',
          },
        };
        yield {
          type: 'phase',
          data: { phase: 'validating_findings', status: 'complete' },
        };
        return {
          inputTokens,
          outputTokens,
          tokensUsed: inputTokens + outputTokens,
        };
      }

      const rawIssues = this.extractRawIssues(parsed);
      this.logger.log(`Parsed ${rawIssues.length} raw issues from AI response`);

      const detectedLanguage = normalizeDetectedLanguage(
        this.readString(parsed.language),
        dto.code,
      );

      let validatedIssues = (
        await this.issueValidator.validate(
          dto.code,
          detectedLanguage ?? dto.language ?? 'auto',
          rawIssues,
        )
      ).issues;

      if (rawIssues.length > 0 && validatedIssues.length === 0) {
        this.logger.warn(
          'Validator returned 0 issues — falling back to AI findings',
        );
        validatedIssues = processIssues(rawIssues, this.minConfidence);
      }

      yield {
        type: 'phase',
        data: { phase: 'validating_findings', status: 'complete' },
      };

      this.logger.log(`Streaming ${validatedIssues.length} validated issues`);

      for (const issue of validatedIssues) {
        yield {
          type: 'issue',
          data: issue as unknown as Record<string, unknown>,
        };
        await this.delay(ISSUE_STREAM_DELAY_MS);
      }

      const summary = this.buildSummary(parsed, dto.code, detectedLanguage);
      if (summary) {
        yield {
          type: 'summary',
          data: summary as unknown as Record<string, unknown>,
        };
        yield {
          type: 'metrics',
          data: summary.metrics as unknown as Record<string, unknown>,
        };
      }

      const tokensUsed =
        inputTokens + outputTokens || Math.ceil(prompt.length / 4);
      return { inputTokens, outputTokens, tokensUsed };
    } catch (error) {
      this.logger.error('LLM streaming failed', error);
      yield {
        type: 'error',
        data: {
          message:
            error instanceof Error ? error.message : 'LLM request failed',
        },
      };
      return {
        inputTokens,
        outputTokens,
        tokensUsed: inputTokens + outputTokens,
      };
    }
  }

  private async createReviewStream(
    openai: OpenAI,
    prompt: string,
    maxTokens: number,
  ) {
    const baseParams = {
      model: this.model,
      messages: [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const, content: prompt },
      ],
      stream: true as const,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      temperature: 0.1,
    };

    try {
      return await openai.chat.completions.create({
        ...baseParams,
        response_format: { type: 'json_object' },
      });
    } catch (error) {
      if (!isOpenRouter(this.configService)) {
        throw error;
      }

      this.logger.warn(
        'JSON response_format failed on OpenRouter — retrying without it',
        error,
      );
      return openai.chat.completions.create(baseParams);
    }
  }

  private extractRawIssues(parsed: Record<string, unknown>): CodeReviewIssue[] {
    if (!Array.isArray(parsed.issues)) return [];

    return parsed.issues
      .map((raw) =>
        typeof raw === 'object' && raw !== null
          ? normalizeReviewIssue(raw as Record<string, unknown>)
          : null,
      )
      .filter((issue): issue is CodeReviewIssue => issue !== null);
  }

  private buildSummary(
    parsed: Record<string, unknown>,
    code: string,
    detectedLanguage?: string,
  ): CodeReviewSummary | null {
    const summaryText = this.readString(parsed.summary);
    if (!summaryText) return null;

    const metrics = this.parseMetrics(parsed.metrics);
    const overallScore = Math.round(metrics.codeQualityScore / 10);
    const language =
      detectedLanguage ??
      normalizeDetectedLanguage(this.readString(parsed.language), code);

    return {
      summary: summaryText,
      overallScore,
      metrics,
      language,
    };
  }

  private parseMetrics(value: unknown): CodeReviewMetrics {
    const metrics =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : {};

    return {
      codeQualityScore: this.clampScore(metrics.codeQualityScore),
      securityScore: this.clampScore(metrics.securityScore),
      maintainabilityScore: this.clampScore(metrics.maintainabilityScore),
    };
  }

  private clampScore(value: unknown): number {
    const num = Number(value);
    if (Number.isNaN(num)) return 0;
    return Math.min(100, Math.max(0, Math.round(num)));
  }

  private tryParseJsonObject(text: string): Record<string, unknown> | null {
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      this.logger.warn(
        `Failed to parse AI response normally. Attempting repair. Length=${text.length}`,
      );
      return this.repairJson(
        text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim(),
      );
    }
  }

  private repairJson(text: string): Record<string, unknown> | null {
    let lastBrace = text.lastIndexOf('}');
    let attempts = 0;
    while (lastBrace !== -1 && attempts < 20) {
      const truncated = text.substring(0, lastBrace + 1);
      const options = [
        truncated,
        truncated + ']}',
        truncated + '}',
        truncated + '}]}',
        truncated + '"}]}',
      ];

      for (const opt of options) {
        try {
          const parsed = JSON.parse(opt);
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issues)) {
            this.logger.warn(`Repaired truncated JSON with ${parsed.issues.length} issues`);
            return parsed as Record<string, unknown>;
          }
        } catch {
          // ignore
        }
      }
      lastBrace = text.lastIndexOf('}', lastBrace - 1);
      attempts++;
    }
    return null;
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
