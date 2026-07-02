import { CodeReviewService } from './code-review.service';

describe('CodeReviewService parseReviewResponse (via prototype)', () => {
  const service = Object.create(CodeReviewService.prototype) as CodeReviewService;
  (service as unknown as { logger: { warn: jest.Mock } }).logger = {
    warn: jest.fn(),
  };

  const parse = (
    jsonBuffer: string,
    truncated = false,
    code = 'const x = 1;',
  ) =>
    (
      service as unknown as {
        parseReviewResponse: (
          buffer: string,
          isTruncated: boolean,
          snippet: string,
        ) => {
          rawIssues: unknown[];
          responseValid: boolean;
        };
      }
    ).parseReviewResponse(jsonBuffer, truncated, code);

  it('treats valid JSON with empty issues as a successful review', () => {
    const json = JSON.stringify({
      summary: 'Clean layout file with no confirmed defects.',
      language: 'TypeScript',
      issues: [],
      metrics: {
        codeQualityScore: 92,
        securityScore: 90,
        maintainabilityScore: 91,
      },
    });

    const result = parse(json);
    expect(result.responseValid).toBe(true);
    expect(result.rawIssues).toHaveLength(0);
  });

  it('rejects empty AI output', () => {
    const result = parse('');
    expect(result.responseValid).toBe(false);
    expect(result.rawIssues).toHaveLength(0);
  });
});
