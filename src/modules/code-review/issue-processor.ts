import { CodeReviewIssue } from './interfaces/code-review.interface';

const MIN_CONFIDENCE = 80;

export function filterByConfidence(
  issues: CodeReviewIssue[],
  minConfidence = MIN_CONFIDENCE,
): CodeReviewIssue[] {
  return issues.filter((issue) => issue.confidence >= minConfidence);
}

function normalizeKey(title: string, line: number | null): string {
  return `${title.toLowerCase().replace(/\s+/g, ' ').trim()}|${line ?? 'n'}`;
}

/** Deduplicate findings that share the same title + line (same root cause). */
export function deduplicateIssues(issues: CodeReviewIssue[]): CodeReviewIssue[] {
  const seen = new Map<string, CodeReviewIssue>();

  for (const issue of issues) {
    const key = normalizeKey(issue.title, issue.line);
    const existing = seen.get(key);
    if (!existing || issue.confidence > existing.confidence) {
      seen.set(key, issue);
    }
  }

  return [...seen.values()];
}

export function processIssues(issues: CodeReviewIssue[]): CodeReviewIssue[] {
  return deduplicateIssues(filterByConfidence(issues));
}
