export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CodeReviewIssue {
  title: string;
  category: string;
  /** @deprecated use category — kept for backward compatibility */
  type: string;
  severity: IssueSeverity;
  line: number | null;
  explanation: string;
  /** @deprecated use explanation — kept for backward compatibility */
  message: string;
  evidence: string;
  suggestedFix: string;
  /** @deprecated use suggestedFix — kept for backward compatibility */
  suggestion: string;
  confidence: number;
}

export interface CodeReviewMetrics {
  codeQualityScore: number;
  securityScore: number;
  maintainabilityScore: number;
}

export interface CodeReviewSummary {
  summary: string;
  overallScore: number;
  metrics: CodeReviewMetrics;
  language?: string;
}

export interface StreamEvent {
  type:
    | 'phase'
    | 'issue'
    | 'issue_partial'
    | 'summary'
    | 'metrics'
    | 'token'
    | 'error'
    | 'done'
    | 'text'
    | 'notice'
    | 'ping';
  data: Record<string, unknown>;
}

export interface TokenUsageResult {
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
}

export interface ReviewTokenBudget {
  lines: number;
  loc: number;
  maxIssues: number;
  maxOutputTokens: number;
}

export interface ParsedReviewResponse {
  summary: CodeReviewSummary | null;
  issues: CodeReviewIssue[];
}
