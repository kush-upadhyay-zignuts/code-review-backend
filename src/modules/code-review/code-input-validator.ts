export interface CodeInputValidation {
  valid: boolean;
  error?: string;
}

export const MAX_CODE_INPUT_LENGTH = 50_000;

/** Declaration / module patterns — strong evidence of source code. */
const DECLARATION_PATTERNS: RegExp[] = [
  /^\s*#!\/[^\n]+/m,
  /^\s*import\s+(\{[^}]+\}|['"][^'"]+['"]|\w+\s+from\b)/m,
  /^\s*export\s+(default\s+)?(class|function|const|let|var|interface|type|async)\b/m,
  /^\s*(package|#include|using|namespace)\s/m,
  /^\s*(def|fn|func|fun)\s+\w+/m,
  /^\s*(class|interface|struct|enum|trait|impl)\s+(?!(?:is|in|of|the|a|an|to|for|with|from|this|that|not|here|neither|words|session|document|plain|text|only|through|user)\b)[A-Za-z_]\w*/m,
  /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+/im,
  /function\s+[A-Za-z_]\w*\s*\(/,
  /\b(const|let|var)\s+\w+\s*=/,
  /\b(public|private|protected)\s+(static\s+)?(class|void|fun|func)\b/,
  /<\/?[a-z][\w-]*(\s|>)/i,
  /<\?php\b/i,
  /^\s*type\s+[A-Za-z_]\w*\s*=/m,
];

/** Structural syntax — must be unambiguous (no bare parentheses or key:value prose). */
const STRUCTURAL_PATTERNS: RegExp[] = [
  /\{[\s\S]*\}/,
  /\)\s*=>\s*\{/,
  /;\s*$/,
  /=>/,
  /::/,
  /:=/,
  /\b(const|let|var)\s+\w+\s*=\s*[^=]/,
  /\.(map|filter|forEach|push|pop|slice|log|json|then|catch)\s*\(/i,
  /[{}[\];]=<>+\-*\/%&|!]{2,}/,
  /^\s*@\w+/m,
  /^\s*(echo|curl|npm|git|docker)\s+/im,
];

const STRONG_CODE_LINE =
  /(?:^\s*import\s+(\{[^}]+\}|['"][^'"]+['"]|\w+\s+from)\b)|(?:^\s*export\s+(default\s+)?(class|function|const|let|var|interface|type|async)\b)|(?:^\s*function\s+[A-Za-z_]\w*\s*\()|(?:^\s*(class|interface|type)\s+(?!(?:is|in|of|the|a|an|to|for|with|from|this|that|not|here|neither|words|session|document|plain|text|only|through|user)\b)[A-Za-z_]\w*)|(?:^\s*(const|let|var)\s+\w+\s*=)|(?:^\s*(def|fn|func|fun)\s+\w+)|[{};]|=>|::|:=|<\/?[a-z][\w-]*|<\?php/i;

const PROSE_WORDS = new Set([
  'the',
  'and',
  'is',
  'are',
  'was',
  'were',
  'this',
  'that',
  'with',
  'from',
  'have',
  'has',
  'please',
  'hello',
  'dear',
  'write',
  'essay',
  'paragraph',
  'story',
  'about',
  'would',
  'could',
  'should',
  'thank',
  'thanks',
  'review',
  'help',
  'want',
  'need',
  'just',
  'some',
  'random',
  'text',
  'normal',
  'not',
]);

function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ');
}

function getMeaningfulLines(code: string): string[] {
  return code.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('//')) return false;
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return false;
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) return false;
    return true;
  });
}

function countCodeLikeLines(text: string): number {
  return getMeaningfulLines(text).filter((line) =>
    STRONG_CODE_LINE.test(line),
  ).length;
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasDeclarationSyntax(text: string): boolean {
  return DECLARATION_PATTERNS.some((pattern) => pattern.test(text));
}

function structuralScore(text: string): number {
  return countPatternMatches(text, STRUCTURAL_PATTERNS);
}

function looksLikePlainProse(text: string): boolean {
  const stripped = stripCommentsAndStrings(text);
  const lines = getMeaningfulLines(stripped);

  if (lines.length === 0) {
    return true;
  }

  if (countCodeLikeLines(stripped) >= 1 || hasDeclarationSyntax(stripped)) {
    return false;
  }

  const singleLine = lines.length === 1 ? lines[0].trim() : '';
  if (
    singleLine &&
    /^[a-zA-Z0-9\s.,!?'"-]+$/.test(singleLine) &&
    singleLine.split(/\s+/).length >= 3
  ) {
    return true;
  }

  const words = stripped
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/g, ''))
    .filter(Boolean);

  const proseHits = words.filter((word) => PROSE_WORDS.has(word)).length;
  const wordCount = words.length;

  if (wordCount >= 4 && proseHits / wordCount >= 0.4) {
    return true;
  }

  if (
    lines.length >= 2 &&
    !/[{};[\]()=<>]/.test(stripped) &&
    lines.every((line) => /^[a-zA-Z0-9\s.,!?'":-]+$/.test(line.trim()))
  ) {
    const words = stripped
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z]/g, ''))
      .filter(Boolean);
    if (words.length >= 3) {
      return true;
    }
  }

  const alphaChars = (stripped.match(/[a-zA-Z]/g) ?? []).length;
  const codeChars = (stripped.match(/[{}[\]();=<>+\-*\/%&|!@#:]/g) ?? []).length;
  const avgLineLength =
    lines.reduce((sum, line) => sum + line.length, 0) / lines.length;

  return (
    alphaChars > 30 &&
    codeChars === 0 &&
    avgLineLength > 40 &&
    lines.every((line) => /^[a-zA-Z\s.,!?'"-]+$/.test(line.trim()))
  );
}

function hasRecognizableCodeSyntax(text: string): boolean {
  if (hasDeclarationSyntax(text)) {
    return true;
  }

  const codeLikeLines = countCodeLikeLines(text);
  if (codeLikeLines >= 1) {
    return true;
  }

  const score = structuralScore(text);
  return score >= 2 && /[{};]|=>|::|:=/.test(text);
}

export function validateCodeInput(code: string): CodeInputValidation {
  const trimmed = code.trim();

  if (!trimmed) {
    return {
      valid: false,
      error: 'Paste some source code before running a review.',
    };
  }

  if (trimmed.length > MAX_CODE_INPUT_LENGTH) {
    return {
      valid: false,
      error: `Code snippet is too long (max ${MAX_CODE_INPUT_LENGTH.toLocaleString()} characters).`,
    };
  }

  if (trimmed.length < 8) {
    return {
      valid: false,
      error:
        'Code snippet is too short. Paste a complete function or file snippet.',
    };
  }

  if (getMeaningfulLines(trimmed).length === 0) {
    return {
      valid: false,
      error:
        'Only comments or blank lines found. Paste executable source code to review.',
    };
  }

  if (looksLikePlainProse(trimmed)) {
    return {
      valid: false,
      error:
        'This looks like plain text, not source code. Paste a code snippet to review.',
    };
  }

  if (!hasRecognizableCodeSyntax(trimmed)) {
    return {
      valid: false,
      error:
        'No recognizable code syntax found. Paste valid source code (e.g. JavaScript, Python, Java).',
    };
  }

  return { valid: true };
}
