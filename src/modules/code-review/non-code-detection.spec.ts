import {
  indicatesNonCodeInput,
  isNonCodeLanguage,
  summaryIndicatesNonCode,
} from './non-code-detection';

describe('non-code detection', () => {
  it('detects text-like languages', () => {
    expect(isNonCodeLanguage('Text')).toBe(true);
    expect(isNonCodeLanguage('plain text')).toBe(true);
    expect(isNonCodeLanguage('TypeScript')).toBe(false);
  });

  it('detects non-code summaries', () => {
    expect(
      summaryIndicatesNonCode('No executable code found; no issues detected.'),
    ).toBe(true);
    expect(summaryIndicatesNonCode('Clean layout file with no defects.')).toBe(
      false,
    );
  });

  it('combines language and summary signals', () => {
    expect(
      indicatesNonCodeInput({
        language: 'Text',
        summary: 'Looks fine.',
      }),
    ).toBe(true);
    expect(
      indicatesNonCodeInput({
        language: 'TypeScript',
        summary: 'No executable code found.',
      }),
    ).toBe(true);
    expect(
      indicatesNonCodeInput({
        language: 'TypeScript',
        summary: 'Clean layout file.',
      }),
    ).toBe(false);
  });
});
