const PLACEHOLDER_LANGUAGES = new Set([
  'auto',
  'auto-detected',
  'unknown',
  'n/a',
  '',
]);

const LANGUAGE_RULES: { lang: string; test: RegExp }[] = [
  { lang: 'Python', test: /^\s*def \w+\(|^\s*import \w+|^\s*from \w+ import/m },
  { lang: 'TypeScript', test: /\bexport type \w+|\binterface \w+|\btype \w+\s*=|:\s*(string|number|boolean|void|FC)\b/ },
  { lang: 'JavaScript', test: /\bimport\s+React\b|\buseState\s*\(|\buseEffect\s*\(/ },
  { lang: 'JavaScript', test: /\b(const|let|var)\s+\w+\s*=|function\s+\w+|\b=>\b/ },
  { lang: 'Java', test: /\bpublic\s+(class|static)\b|\bSystem\.out\.println/ },
  { lang: 'Kotlin', test: /\bfun\s+\w+\(|\bval\s+\w+/ },
  { lang: 'Swift', test: /\bfunc\s+\w+\(|import\s+Foundation/ },
  { lang: 'Go', test: /\bpackage\s+\w+|\bfunc\s+\w+\(/ },
  { lang: 'Rust', test: /\bfn\s+\w+\(|let\s+mut\s+/ },
  { lang: 'C#', test: /\bnamespace\s+|\busing\s+System/ },
  { lang: 'C++', test: /#include\s*<[^>]+>|std::/ },
  { lang: 'C', test: /#include\s*<stdio\.h>|#include\s*<stdlib\.h>/ },
  { lang: 'PHP', test: /<\?php/ },
  { lang: 'Ruby', test: /\bdef \w+\n|^\s*end\s*$/m },
  { lang: 'SQL', test: /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s+/im },
  { lang: 'Shell', test: /^#!\/bin\/(bash|sh|zsh)/m },
  { lang: 'HTML', test: /<(!DOCTYPE\s+html|html|div|script)\b/i },
  { lang: 'CSS', test: /[.#]?[\w-]+\s*\{[^}]*:[^};]+;/ },
  { lang: 'Scala', test: /\bobject\s+\w+|\bdef\s+\w+\(/ },
  { lang: 'Dart', test: /\bvoid\s+main\s*\(|import\s+'package:/ },
  { lang: 'Lua', test: /\blocal\s+\w+\s*=/ },
];

export function isPlaceholderLanguage(language?: string | null): boolean {
  const normalized = language?.trim().toLowerCase() ?? '';
  return PLACEHOLDER_LANGUAGES.has(normalized);
}

export function detectLanguageFromCode(code: string): string | undefined {
  const sample = code.slice(0, 12_000);

  for (const { lang, test } of LANGUAGE_RULES) {
    if (test.test(sample)) {
      return lang;
    }
  }

  return undefined;
}

export function normalizeDetectedLanguage(
  language: string | undefined,
  code?: string,
): string | undefined {
  if (!isPlaceholderLanguage(language)) {
    return language!.trim();
  }

  return detectLanguageFromCode(code ?? '');
}

export function countCodeLines(code: string): number {
  return code.split('\n').length;
}

export function resolveMaxOutputTokens(
  code: string,
  configuredMax: number,
): number {
  const lines = countCodeLines(code);

  if (lines <= 80) {
    return Math.max(configuredMax, 6144);
  }
  if (lines <= 200) {
    return Math.max(configuredMax, 8192);
  }

  return Math.max(configuredMax, 16_384);
}
