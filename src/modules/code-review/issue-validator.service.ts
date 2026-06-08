import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  VALIDATOR_SYSTEM_PROMPT,
  buildValidatorPrompt,
} from './prompts/code-review.prompt';
import { CodeReviewIssue } from './interfaces/code-review.interface';
import { processIssues } from './issue-processor';

@Injectable()
export class IssueValidatorService {
  private readonly logger = new Logger(IssueValidatorService.name);
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly minConfidence: number;

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('ai.model')?.trim() || 'gpt-4o-mini';
    this.enabled =
      this.configService.get<string>('ai.validatorEnabled', 'true') === 'true';
    this.minConfidence =
      this.configService.get<number>('ai.minConfidence') ?? 80;
  }

  private getOpenAiClient(): OpenAI | null {
    const apiKey = this.configService.get<string>('ai.apiKey')?.trim();
    if (!apiKey || apiKey.includes('your_openai_api_key')) return null;

    return new OpenAI({
      apiKey,
      baseURL: this.configService.get<string>('ai.baseUrl'),
    });
  }

  async validate(
    code: string,
    language: string,
    issues: CodeReviewIssue[],
  ): Promise<{ issues: CodeReviewIssue[]; rejectedCount: number }> {
    const preFiltered = processIssues(issues, this.minConfidence);
    if (!preFiltered.length) {
      return { issues: [], rejectedCount: 0 };
    }

    if (!this.enabled) {
      return { issues: preFiltered, rejectedCount: 0 };
    }

    const openai = this.getOpenAiClient();
    if (!openai) {
      return { issues: preFiltered, rejectedCount: 0 };
    }

    try {
      const response = await openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildValidatorPrompt(code, language, preFiltered),
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as {
        issues?: unknown[];
        rejectedCount?: number;
      };

      const validated = processIssues(
        (Array.isArray(parsed.issues) ? parsed.issues : [])
          .map((item) => this.normalizeIssue(item as Record<string, unknown>))
          .filter((issue): issue is CodeReviewIssue => issue !== null),
        this.minConfidence,
      );

      const rejectedCount =
        typeof parsed.rejectedCount === 'number'
          ? parsed.rejectedCount
          : Math.max(0, preFiltered.length - validated.length);

      if (
        preFiltered.length >= 4 &&
        validated.length < Math.ceil(preFiltered.length * 0.55)
      ) {
        this.logger.warn(
          `Validator pruned too aggressively (${preFiltered.length} → ${validated.length}); keeping pre-filtered findings`,
        );
        return { issues: preFiltered, rejectedCount: 0 };
      }

      this.logger.log(
        `Validator: ${preFiltered.length} proposed → ${validated.length} validated (${rejectedCount} rejected)`,
      );

      return { issues: validated, rejectedCount };
    } catch (error) {
      this.logger.warn('Validator pass failed, using pre-filtered issues', error);
      return { issues: preFiltered, rejectedCount: 0 };
    }
  }

  private normalizeIssue(
    parsed: Record<string, unknown>,
  ): CodeReviewIssue | null {
    const explanation =
      typeof parsed.explanation === 'string'
        ? parsed.explanation
        : typeof parsed.message === 'string'
          ? parsed.message
          : '';

    const title =
      typeof parsed.title === 'string'
        ? parsed.title
        : explanation.slice(0, 80);

    if (!title || !explanation) return null;

    const suggestedFix =
      typeof parsed.suggestedFix === 'string'
        ? parsed.suggestedFix
        : typeof parsed.suggestion === 'string'
          ? parsed.suggestion
          : '';

    const category =
      typeof parsed.category === 'string'
        ? parsed.category
        : typeof parsed.type === 'string'
          ? parsed.type
          : 'Bug';

    const confidence =
      typeof parsed.confidence === 'number' ? parsed.confidence : 0;

    return {
      title,
      category,
      type: category,
      severity: this.normalizeSeverity(parsed.severity),
      line: typeof parsed.line === 'number' ? parsed.line : null,
      explanation,
      message: explanation,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
      suggestedFix,
      suggestion: suggestedFix,
      confidence,
    };
  }

  private normalizeSeverity(value: unknown): CodeReviewIssue['severity'] {
    const severity = String(value ?? 'medium').toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(severity)) {
      return severity as CodeReviewIssue['severity'];
    }
    return 'medium';
  }
}
