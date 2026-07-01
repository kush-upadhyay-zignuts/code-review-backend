import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VALIDATOR_SYSTEM_PROMPT,
  buildValidatorPrompt,
} from './prompts/code-review.prompt';
import { createAiClient, getAiModel, isOpenRouter } from './ai-openai-client';
import { countCodeLines } from './language-utils';
import { normalizeReviewIssue } from './issue-normalizer';
import { CodeReviewIssue } from './interfaces/code-review.interface';
import { processIssues } from './issue-processor';

@Injectable()
export class IssueValidatorService {
  private readonly logger = new Logger(IssueValidatorService.name);
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly minConfidence: number;

  constructor(private readonly configService: ConfigService) {
    this.model = getAiModel(this.configService);
    this.enabled =
      this.configService.get<string>('ai.validatorEnabled', 'true') === 'true';
    this.minConfidence =
      this.configService.get<number>('ai.minConfidence') ?? 80;
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

    const openai = createAiClient(this.configService);
    if (!openai) {
      return { issues: preFiltered, rejectedCount: 0 };
    }

    const lines = countCodeLines(code);
    const maxValidatorIssues = lines > 120 ? 20 : 30;
    const issuesForValidation = preFiltered.slice(0, maxValidatorIssues);
    const remainderIssues = preFiltered.slice(maxValidatorIssues);

    try {
      const baseParams = {
        model: this.model,
        temperature: 0,
        max_tokens: lines > 120 ? 6144 : 4096,
        messages: [
          { role: 'system' as const, content: VALIDATOR_SYSTEM_PROMPT },
          {
            role: 'user' as const,
            content: buildValidatorPrompt(code, language, issuesForValidation),
          },
        ],
      };

      let response;
      try {
        response = await openai.chat.completions.create({
          ...baseParams,
          response_format: { type: 'json_object' },
        });
      } catch (error) {
        if (!isOpenRouter(this.configService)) {
          throw error;
        }
        response = await openai.chat.completions.create(baseParams);
      }

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as {
        issues?: unknown[];
        rejectedCount?: number;
      };

      const validated = processIssues(
        (Array.isArray(parsed.issues) ? parsed.issues : [])
          .map((item) => normalizeReviewIssue(item as Record<string, unknown>))
          .filter((issue): issue is CodeReviewIssue => issue !== null),
        this.minConfidence,
      );

      const rejectedCount =
        typeof parsed.rejectedCount === 'number'
          ? parsed.rejectedCount
          : Math.max(0, issuesForValidation.length - validated.length);

      if (!validated.length) {
        this.logger.warn('Validator returned no issues — keeping pre-filtered findings');
        return {
          issues: [...issuesForValidation, ...remainderIssues],
          rejectedCount: 0,
        };
      }

      if (
        issuesForValidation.length >= 4 &&
        validated.length < Math.ceil(issuesForValidation.length * 0.55)
      ) {
        this.logger.warn(
          `Validator pruned too aggressively (${issuesForValidation.length} → ${validated.length}); keeping pre-filtered findings`,
        );
        return {
          issues: [...issuesForValidation, ...remainderIssues],
          rejectedCount: 0,
        };
      }

      this.logger.log(
        `Validator: ${issuesForValidation.length} proposed → ${validated.length} validated (${rejectedCount} rejected)`,
      );

      return {
        issues: [...validated, ...remainderIssues],
        rejectedCount,
      };
    } catch (error) {
      this.logger.warn('Validator pass failed, using pre-filtered issues', error);
      return { issues: preFiltered, rejectedCount: 0 };
    }
  }
}
