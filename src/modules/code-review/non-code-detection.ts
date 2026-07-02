const NON_CODE_LANGUAGES = new Set([
  'text',
  'plain text',
  'plaintext',
  'plain-text',
  'prose',
  'natural language',
  'english',
  'document',
  'markdown',
  'none',
  'n/a',
  'unknown',
]);

const NON_CODE_SUMMARY_PATTERNS = [
  /\bno executable code\b/i,
  /\bnot (source |valid )?code\b/i,
  /\bnot a code\b/i,
  /\bplain text\b/i,
  /\bnatural language\b/i,
  /\bno code\b/i,
  /\bnon[- ]code\b/i,
  /\bappears to be (plain )?text\b/i,
  /\bdoes not (appear|look|seem) to be (source )?code\b/i,
  /\bnot (programming|source) code\b/i,
];

export function isNonCodeLanguage(language?: string | null): boolean {
  const normalized = language?.trim().toLowerCase() ?? '';
  if (!normalized) return false;
  return NON_CODE_LANGUAGES.has(normalized);
}

export function summaryIndicatesNonCode(summary?: string | null): boolean {
  const text = summary?.trim() ?? '';
  if (!text) return false;
  return NON_CODE_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

export function indicatesNonCodeInput(input: {
  language?: string | null;
  summary?: string | null;
}): boolean {
  return (
    isNonCodeLanguage(input.language) ||
    summaryIndicatesNonCode(input.summary)
  );
}

export const NON_CODE_INPUT_MESSAGE =
  'This does not look like source code. Paste a valid code snippet (e.g. JavaScript, Python, TypeScript) to review.';
