import { CodeReviewIssue } from './interfaces/code-review.interface';
import { normalizeReviewIssue } from './issue-normalizer';

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractCompleteJsonObjects(buffer: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let i = 0;

  while (i < buffer.length) {
    while (i < buffer.length && /\s/.test(buffer[i])) i += 1;
    if (i >= buffer.length) break;

    if (buffer[i] !== '{') {
      const next = buffer.indexOf('{', i);
      if (next === -1) break;
      i = next;
    }

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; i < buffer.length; i += 1) {
      const char = buffer[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParseJson(buffer.slice(start, i + 1));
          if (parsed) objects.push(parsed);
          i += 1;
          break;
        }
      }
    }

    if (depth !== 0) break;
  }

  return objects;
}

function looksLikeIssue(obj: Record<string, unknown>): boolean {
  return Boolean(
    obj.severity ||
      obj.title ||
      obj.explanation ||
      obj.message ||
      obj.evidence,
  );
}

/** Pull complete issue objects out of a truncated review JSON buffer. */
export function salvageIssuesFromBuffer(buffer: string): CodeReviewIssue[] {
  const cleaned = buffer.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const issues: CodeReviewIssue[] = [];
  const seen = new Set<string>();

  const root = tryParseJson(cleaned);
  if (root && Array.isArray(root.issues)) {
    for (const raw of root.issues) {
      if (typeof raw !== 'object' || raw === null) continue;
      const issue = normalizeReviewIssue(raw as Record<string, unknown>);
      if (!issue) continue;
      const key = `${issue.title}|${issue.line ?? 'n'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
    if (issues.length > 0) return issues;
  }

  for (const obj of extractCompleteJsonObjects(cleaned)) {
    if (!looksLikeIssue(obj)) continue;
    const issue = normalizeReviewIssue(obj);
    if (!issue) continue;
    const key = `${issue.title}|${issue.line ?? 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }

  return issues;
}

export function salvageSummaryFromBuffer(buffer: string): string {
  const match = buffer.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  if (!match) return '';
  return match[1]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
