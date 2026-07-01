import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildStructuredReviewPrompt,
  SYSTEM_PROMPT,
} from './prompts/code-review.prompt';
import { createAiClient, getAiModel } from './ai-openai-client';
import { CreateCodeReviewDto } from './dto/create-code-review.dto';
import {
  CodeReviewIssue,
  CodeReviewMetrics,
  CodeReviewSummary,
  StreamEvent,
  TokenUsageResult,
} from './interfaces/code-review.interface';
import { IssueValidatorService } from './issue-validator.service';

const PHASES = [
  'analyzing_syntax',
  'checking_security',
  'checking_performance',
  'checking_style',
  'validating_findings',
] as const;

const ISSUE_STREAM_DELAY_MS = 450;

@Injectable()
export class CodeReviewService {
  private readonly logger = new Logger(CodeReviewService.name);
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly issueValidator: IssueValidatorService,
  ) {
    this.model = getAiModel(this.configService);
    this.maxOutputTokens = this.configService.get<number>(
      'ai.maxOutputTokens',
      4096,
    );
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
    let inputTokens = 0;
    let outputTokens = 0;
    let jsonBuffer = '';

    try {
      const stream = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: this.maxOutputTokens,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

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
          data: { message: 'Failed to parse AI review response as JSON.' },
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
      const { issues: validatedIssues } = await this.issueValidator.validate(
        dto.code,
        dto.language ?? 'auto',
        rawIssues,
      );

      yield {
        type: 'phase',
        data: { phase: 'validating_findings', status: 'complete' },
      };

      for (const issue of validatedIssues) {
        yield {
          type: 'issue',
          data: issue as unknown as Record<string, unknown>,
        };
        await this.delay(ISSUE_STREAM_DELAY_MS);
      }

      const summary = this.buildSummary(parsed);
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

  private extractRawIssues(parsed: Record<string, unknown>): CodeReviewIssue[] {
    if (!Array.isArray(parsed.issues)) return [];

    return parsed.issues
      .map((raw) =>
        typeof raw === 'object' && raw !== null
          ? this.normalizeIssue(raw as Record<string, unknown>)
          : null,
      )
      .filter((issue): issue is CodeReviewIssue => issue !== null);
  }

  private buildSummary(
    parsed: Record<string, unknown>,
  ): CodeReviewSummary | null {
    const summaryText = this.readString(parsed.summary);
    if (!summaryText) return null;

    const metrics = this.parseMetrics(parsed.metrics);
    const overallScore = Math.round(metrics.codeQualityScore / 10);

    return { summary: summaryText, overallScore, metrics };
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

  private normalizeIssue(
    parsed: Record<string, unknown>,
  ): CodeReviewIssue | null {
    const explanation =
      this.readString(parsed.explanation) || this.readString(parsed.message);
    const title = this.readString(parsed.title) || explanation.slice(0, 80);

    if (!title || !explanation) return null;

    const category =
      this.readString(parsed.category) ||
      this.readString(parsed.issueType) ||
      this.readString(parsed.type) ||
      'Bug';

    const suggestedFix =
      this.readString(parsed.suggestedFix) ||
      this.readString(parsed.suggestion);

    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0;

    return {
      title,
      category: category === 'issue' ? 'Bug' : category,
      type: category === 'issue' ? 'Bug' : category,
      severity: this.normalizeSeverity(parsed.severity),
      line: typeof parsed.line === 'number' ? parsed.line : null,
      explanation,
      message: explanation,
      evidence: this.readString(parsed.evidence),
      suggestedFix,
      suggestion: suggestedFix,
      confidence,
    };
  }

  private tryParseJsonObject(text: string): Record<string, unknown> | null {
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return this.repairJson(text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
    }
  }

  private repairJson(text: string): Record<string, unknown> | null {
    let lastBrace = text.lastIndexOf('}');
    let attempts = 0;
    while (lastBrace !== -1 && attempts < 10) {
      const truncated = text.substring(0, lastBrace + 1);
      const options = [
        truncated,
        truncated + ']}',
        truncated + '}',
        truncated + '}]}',
      ];

      for (const opt of options) {
        try {
          const parsed = JSON.parse(opt);
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issues)) {
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

  private normalizeSeverity(value: unknown): CodeReviewIssue['severity'] {
    const severity = String(value ?? 'medium').toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(severity)) {
      return severity as CodeReviewIssue['severity'];
    }
    return 'medium';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
