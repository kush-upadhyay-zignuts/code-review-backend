import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildStructuredReviewPrompt,
  SYSTEM_PROMPT,
} from './prompts/code-review.prompt';
import { createAiClient, getAiModel, isOpenRouter } from './ai-openai-client';
import { CreateCodeReviewDto } from './dto/create-code-review.dto';
import {
  countCodeLines,
  normalizeDetectedLanguage,
} from './language-utils';
import {
  indicatesNonCodeInput,
  NON_CODE_INPUT_MESSAGE,
} from './non-code-detection';
import { getReviewTokenBudget } from './review-budget';
import { normalizeReviewIssue, compactReviewIssue } from './issue-normalizer';
import { mergeReviewIssues, processIssues } from './issue-processor';
import {
  salvageIssuesFromBuffer,
  salvageSummaryFromBuffer,
  salvageMetricsFromBuffer,
  salvageLanguageFromBuffer,
} from './json-salvage';
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

const SEVERITY_RANK: Record<CodeReviewIssue['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

@Injectable()
export class CodeReviewService {
  private readonly logger = new Logger(CodeReviewService.name);
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly minConfidence: number;
  private readonly validatorEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly issueValidator: IssueValidatorService,
  ) {
    this.model = getAiModel(this.configService);
    this.maxOutputTokens = this.configService.get<number>(
      'ai.maxOutputTokens',
      20_384,
    );
    this.minConfidence =
      this.configService.get<number>('ai.minConfidence') ?? 80;
    this.validatorEnabled =
      this.configService.get<string>('ai.validatorEnabled', 'false') === 'true';
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

    const budget = getReviewTokenBudget(dto.code, this.maxOutputTokens);
    const prompt = buildStructuredReviewPrompt(
      dto.code,
      dto.language ?? 'auto',
      budget,
    );

    this.logger.log(
      `Review budget: maxOut=${budget.maxOutputTokens} maxIssues=${budget.maxIssues} loc=${budget.loc}`,
    );

    for (const phase of PHASES.slice(0, 4)) {
      yield { type: 'phase', data: { phase, status: 'started' } };
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let jsonBuffer = '';

    try {
      const stream = await this.createReviewStream(
        openai,
        prompt,
        budget.maxOutputTokens,
      );

      for await (const chunk of stream) {
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }

        const content = chunk.choices[0]?.delta?.content ?? '';
        if (!content) continue;

        jsonBuffer += content;
      }

      for (const phase of PHASES.slice(0, 4)) {
        yield { type: 'phase', data: { phase, status: 'complete' } };
      }

      yield {
        type: 'phase',
        data: { phase: 'validating_findings', status: 'started' },
      };

      const truncated =
        outputTokens >= Math.floor(budget.maxOutputTokens * 0.92);
      const parsedResult = this.parseReviewResponse(
        jsonBuffer,
        truncated,
        dto.code,
      );

      if (!parsedResult.responseValid && parsedResult.rawIssues.length === 0) {
        yield {
          type: 'error',
          data: {
            message:
              'Could not extract findings from the AI response. Please try again.',
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

      const { parsed, rawIssues, detectedLanguage } = parsedResult;

      const aiSummary = this.readString(parsed.summary);
      if (
        indicatesNonCodeInput({
          language: detectedLanguage ?? this.readString(parsed.language),
          summary: aiSummary,
        })
      ) {
        yield {
          type: 'error',
          data: { message: NON_CODE_INPUT_MESSAGE },
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

      this.logger.log(
        `Parsed ${rawIssues.length} issues (truncated=${truncated}, out=${outputTokens}/${budget.maxOutputTokens})`,
      );

      let validatedIssues: CodeReviewIssue[];

      const lines = countCodeLines(dto.code);
      const useLlmValidator =
        this.validatorEnabled &&
        !truncated &&
        rawIssues.length > 0 &&
        rawIssues.length <= 3 &&
        lines <= 60;

      if (useLlmValidator) {
        validatedIssues = (
          await this.issueValidator.validate(
            dto.code,
            detectedLanguage ?? dto.language ?? 'auto',
            rawIssues,
          )
        ).issues;
      } else {
        validatedIssues = processIssues(rawIssues, this.minConfidence);
      }

      if (validatedIssues.length === 0) {
        this.logger.warn(
          'No issues after validation — falling back to AI findings',
        );
        validatedIssues = processIssues(rawIssues, this.minConfidence);
      }

      validatedIssues = this.sortIssuesBySeverity(
        validatedIssues.map(compactReviewIssue),
      );

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
      }

      if (truncated && validatedIssues.length > 0) {
        yield {
          type: 'notice',
          data: {
            code: 'output_truncated',
            message: `Output limit reached. Showing ${validatedIssues.length} finding${validatedIssues.length === 1 ? '' : 's'} received before the response was cut off.`,
          },
        };
      }

      const summary = this.buildSummary(
        parsed,
        dto.code,
        detectedLanguage,
        truncated,
        validatedIssues.length,
      );
      yield {
        type: 'summary',
        data: summary as unknown as Record<string, unknown>,
      };
      yield {
        type: 'metrics',
        data: summary.metrics as unknown as Record<string, unknown>,
      };

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

  private parseReviewResponse(
    jsonBuffer: string,
    truncated: boolean,
    code: string,
  ): {
    parsed: Record<string, unknown>;
    rawIssues: CodeReviewIssue[];
    detectedLanguage?: string;
    responseValid: boolean;
  } {
    const trimmed = jsonBuffer.trim();
    let parsed = this.tryParseJsonObject(trimmed);
    const jsonParsed = parsed !== null;
    const fromParsed = parsed ? this.extractRawIssues(parsed) : [];
    const salvaged = salvageIssuesFromBuffer(jsonBuffer);

    if (salvaged.length > 0 && truncated) {
      this.logger.warn(
        `Salvaged ${salvaged.length} issues from truncated AI response`,
      );
    }

    const rawIssues = this.sortIssuesBySeverity(
      mergeReviewIssues(fromParsed, salvaged),
    );

    if (!parsed) {
      parsed = {
        summary:
          salvageSummaryFromBuffer(jsonBuffer) ||
          (truncated && rawIssues.length > 0
            ? `Partial review — ${rawIssues.length} findings extracted before output limit.`
            : ''),
        language: salvageLanguageFromBuffer(jsonBuffer),
        issues: [],
        metrics: salvageMetricsFromBuffer(jsonBuffer),
      };
    }

    const detectedLanguage = normalizeDetectedLanguage(
      this.readString(parsed.language) || salvageLanguageFromBuffer(jsonBuffer),
      code,
    );

    const responseValid = this.isValidAiReviewResponse(
      parsed,
      jsonBuffer,
      jsonParsed,
      rawIssues.length,
    );

    return { parsed, rawIssues, detectedLanguage, responseValid };
  }

  private isValidAiReviewResponse(
    parsed: Record<string, unknown>,
    jsonBuffer: string,
    jsonParsed: boolean,
    issueCount: number,
  ): boolean {
    if (issueCount > 0) return true;
    if (!jsonParsed) return false;

    if (this.readString(parsed.summary) || salvageSummaryFromBuffer(jsonBuffer)) {
      return true;
    }
    if (Array.isArray(parsed.issues)) return true;
    const metrics = parsed.metrics;
    if (metrics && typeof metrics === 'object') {
      const record = metrics as Record<string, unknown>;
      if (
        record.codeQualityScore !== undefined ||
        record.securityScore !== undefined ||
        record.maintainabilityScore !== undefined
      ) {
        return true;
      }
    }
    return false;
  }

  private sortIssuesBySeverity(issues: CodeReviewIssue[]): CodeReviewIssue[] {
    return [...issues].sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
    );
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
      temperature: 0.05,
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
    truncated = false,
    issueCount = 0,
  ): CodeReviewSummary {
    let summaryText = this.readString(parsed.summary).slice(0, 280);
    if (!summaryText && issueCount > 0) {
      summaryText = truncated
        ? `Partial review completed with ${issueCount} confirmed finding${issueCount === 1 ? '' : 's'}.`
        : `Review completed with ${issueCount} confirmed finding${issueCount === 1 ? '' : 's'}.`;
    }
    if (!summaryText && issueCount === 0) {
      summaryText =
        'No confirmed issues found — your code passed security, quality, and maintainability checks.';
    }

    let metrics = this.parseMetrics(parsed.metrics);
    const metricsEmpty =
      !metrics.codeQualityScore &&
      !metrics.securityScore &&
      !metrics.maintainabilityScore;

    if (issueCount === 0 && metricsEmpty) {
      metrics = {
        codeQualityScore: 90,
        securityScore: 90,
        maintainabilityScore: 88,
      };
    }

    const overallScore = Math.round(metrics.codeQualityScore / 10);
    const language =
      detectedLanguage ??
      normalizeDetectedLanguage(this.readString(parsed.language), code);

    return {
      summary: summaryText,
      overallScore: overallScore || (issueCount === 0 ? 9 : 0),
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
}
