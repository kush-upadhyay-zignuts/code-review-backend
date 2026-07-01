import { CodeReviewIssue } from './interfaces/code-review.interface';

export const DEFAULT_ISSUE_CONFIDENCE = 85;

export function parseConfidence(
  value: unknown,
  fallback = DEFAULT_ISSUE_CONFIDENCE,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(100, Math.max(0, Math.round(parsed)));
    }
  }

  return fallback;
}

export function parseIssueLine(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeSeverity(value: unknown): CodeReviewIssue['severity'] {
  const severity = String(value ?? 'medium').toLowerCase();
  if (['critical', 'high', 'medium', 'low'].includes(severity)) {
    return severity as CodeReviewIssue['severity'];
  }
  return 'medium';
}

export function normalizeReviewIssue(
  parsed: Record<string, unknown>,
): CodeReviewIssue | null {
  const explanation =
    readString(parsed.explanation) || readString(parsed.message);
  const title = readString(parsed.title) || explanation.slice(0, 80);

  if (!title && !explanation) return null;

  const category =
    readString(parsed.category) ||
    readString(parsed.issueType) ||
    readString(parsed.type) ||
    'Bug';

  const safeCategory =
    category === 'issue' || category === 'phase' || category === 'summary'
      ? 'Bug'
      : category;

  const suggestedFix =
    readString(parsed.suggestedFix) || readString(parsed.suggestion);

  return {
    title: title || 'Code issue',
    category: safeCategory,
    type: safeCategory,
    severity: normalizeSeverity(parsed.severity),
    line: parseIssueLine(parsed.line),
    explanation: explanation || title,
    message: explanation || title,
    evidence: readString(parsed.evidence),
    suggestedFix,
    suggestion: suggestedFix,
    confidence: parseConfidence(parsed.confidence),
  };
}
