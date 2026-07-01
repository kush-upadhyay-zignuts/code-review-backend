import { CodeReviewIssue } from './interfaces/code-review.interface';
import { normalizeReviewIssue } from './issue-normalizer';

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function issueKey(issue: CodeReviewIssue): string {
  return `${issue.title.toLowerCase()}|${issue.line ?? 'n'}|${issue.category}`;
}

function pushUnique(
  issues: CodeReviewIssue[],
  seen: Set<string>,
  raw: Record<string, unknown>,
): void {
  const issue = normalizeReviewIssue(raw);
  if (!issue) return;
  const key = issueKey(issue);
  if (seen.has(key)) return;
  seen.add(key);
  issues.push(issue);
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

/** Walk the issues array in a truncated buffer and collect every complete issue object. */
function salvageIssuesFromIssuesArray(buffer: string): CodeReviewIssue[] {
  const match = buffer.match(/"issues"\s*:\s*\[/);
  if (!match || match.index === undefined) return [];

  const issues: CodeReviewIssue[] = [];
  const seen = new Set<string>();
  let pos = match.index + match[0].length;

  while (pos < buffer.length) {
    while (pos < buffer.length && /[\s,]/.test(buffer[pos])) pos += 1;
    if (pos >= buffer.length || buffer[pos] === ']') break;
    if (buffer[pos] !== '{') break;

    const start = pos;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;

    for (; pos < buffer.length; pos += 1) {
      const char = buffer[pos];
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
          const parsed = tryParseJson(buffer.slice(start, pos + 1));
          if (parsed) pushUnique(issues, seen, parsed);
          pos += 1;
          closed = true;
          break;
        }
      }
    }

    if (!closed) break;
  }

  return issues;
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
      pushUnique(issues, seen, raw as Record<string, unknown>);
    }
    if (issues.length > 0) return issues;
  }

  const fromArray = salvageIssuesFromIssuesArray(cleaned);
  for (const issue of fromArray) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  if (issues.length > 0) return issues;

  for (const obj of extractCompleteJsonObjects(cleaned)) {
    if (!looksLikeIssue(obj)) continue;
    pushUnique(issues, seen, obj);
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

export function salvageMetricsFromBuffer(
  buffer: string,
): Record<string, unknown> {
  const metrics: Record<string, unknown> = {};
  for (const key of [
    'codeQualityScore',
    'securityScore',
    'maintainabilityScore',
  ]) {
    const match = buffer.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    if (match) metrics[key] = Number(match[1]);
  }
  return metrics;
}

export function salvageLanguageFromBuffer(buffer: string): string {
  const match = buffer.match(/"language"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return '';
  return match[1].replace(/\\"/g, '"');
}
