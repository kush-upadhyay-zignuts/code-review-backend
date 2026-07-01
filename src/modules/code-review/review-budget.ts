import { countCodeLines } from './language-utils';
import type { ReviewTokenBudget } from './interfaces/code-review.interface';

export type { ReviewTokenBudget };

const DEFAULT_MAX_OUTPUT = 16_384;

function countLogicalLines(code: string): number {
  return code.split('\n').filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('*')
    );
  }).length;
}

/** Soft cap for the prompt — does not limit streaming/salvage. */
export function resolvePromptMaxIssues(loc: number): number {
  if (loc <= 40) return 10;
  if (loc <= 120) return 15;
  if (loc <= 250) return 20;
  return 25;
}

/** Uses configured AI_MAX_OUTPUT_TOKENS as-is (e.g. 16k). Prompt guides brevity. */
export function getReviewTokenBudget(
  code: string,
  configuredMax: number,
): ReviewTokenBudget {
  const lines = countCodeLines(code);
  const loc = countLogicalLines(code);
  const maxIssues = resolvePromptMaxIssues(loc);
  const maxOutputTokens =
    configuredMax > 0 ? configuredMax : DEFAULT_MAX_OUTPUT;

  return { lines, loc, maxIssues, maxOutputTokens };
}

export function resolveMaxOutputTokens(
  code: string,
  configuredMax: number,
): number {
  return getReviewTokenBudget(code, configuredMax).maxOutputTokens;
}
