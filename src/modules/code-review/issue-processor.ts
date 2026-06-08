import { CodeReviewIssue } from './interfaces/code-review.interface';

export const DEFAULT_MIN_CONFIDENCE = 80;

export function filterByConfidence(
  issues: CodeReviewIssue[],
  minConfidence = DEFAULT_MIN_CONFIDENCE,
): CodeReviewIssue[] {
  return issues.filter((issue) => issue.confidence >= minConfidence);
}

/** Merge only exact duplicates: same line, category, and normalized title. */
export function deduplicateIssues(issues: CodeReviewIssue[]): CodeReviewIssue[] {
  const seen = new Map<string, CodeReviewIssue>();

  for (const issue of issues) {
    const key = [
      issue.line ?? 'n',
      issue.category.toLowerCase(),
      issue.title.toLowerCase().replace(/\s+/g, ' ').trim(),
    ].join('|');
    const existing = seen.get(key);
    if (!existing || issue.confidence > existing.confidence) {
      seen.set(key, issue);
    }
  }

  return [...seen.values()];
}

export function processIssues(
  issues: CodeReviewIssue[],
  minConfidence = DEFAULT_MIN_CONFIDENCE,
): CodeReviewIssue[] {
  return deduplicateIssues(filterByConfidence(issues, minConfidence));
}
