import type { ReviewTokenBudget } from '../interfaces/code-review.interface';

export const SYSTEM_PROMPT = `You are a senior engineer performing a concise, evidence-based code review.

Return ONLY valid JSON (no markdown). Detect language from the code when not specified.

Rules:
- Report real defects only — runtime errors, edge cases, missing validation, security, production risks.
- Skip style nits and generic advice.
- Prioritize critical/high severity first. Respect maxIssues from the user message.
- Keep each issue SHORT to save tokens (finish valid JSON before hitting output limit):
  * title ≤ 10 words
  * explanation ≤ 90 characters
  * evidence ≤ 50 characters (shortest exact code substring)
  * suggestedFix ≤ 90 characters (omit for low severity)
  * summary ≤ 2 sentences, ≤ 180 characters
- If running long, stop adding issues and close the JSON — partial results beat truncated invalid JSON.
- Escape double quotes inside strings with \\".

Schema:
{"summary":"...","language":"JavaScript","issues":[{"severity":"high","category":"Runtime Error","title":"...","line":1,"explanation":"...","evidence":"...","suggestedFix":"...","confidence":85}],"metrics":{"codeQualityScore":70,"securityScore":80,"maintainabilityScore":75}}`;

export function buildStructuredReviewPrompt(
  code: string,
  language: string,
  budget: ReviewTokenBudget,
): string {
  const isAutoDetect = !language || language.toLowerCase() === 'auto';
  const displayLanguage = isAutoDetect
    ? 'auto-detected'
    : language.charAt(0).toUpperCase() + language.slice(1);

  const languageLine = isAutoDetect
    ? 'Language: auto-detect from code'
    : `Language: ${displayLanguage}`;

  return `${languageLine}
Lines: ${budget.lines} | target up to ${budget.maxIssues} issues (prioritize critical/high; fewer is fine)

Review the snippet. Use short fields. If output is getting long, return fewer issues and complete the JSON.
Check: runtime failures, edge cases, validation, type safety, error handling, production risks.

Code:
\`\`\`
${code}
\`\`\``;
}

export const VALIDATOR_SYSTEM_PROMPT = `Filter hallucinated code review findings only. Return kept issues as JSON: {"issues":[...],"rejectedCount":n}.
Remove only findings whose evidence is absent from the code. Keep all valid findings. Do not invent new issues.
Keep fields short (same limits as input).`;

export function buildValidatorPrompt(
  code: string,
  language: string,
  issues: unknown[],
): string {
  const isAutoDetect = !language || language.toLowerCase() === 'auto';
  return JSON.stringify({
    language: isAutoDetect ? 'auto-detected' : language,
    code: code.length > 4000 ? `${code.slice(0, 4000)}\n/* truncated */` : code,
    proposedFindings: issues,
    instruction: 'Remove hallucinations only. Return valid subset.',
  });
}
