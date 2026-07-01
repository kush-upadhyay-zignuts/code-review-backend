import { getReviewTokenBudget } from './review-budget';

describe('getReviewTokenBudget', () => {
  it('uses configured max output tokens without artificial caps', () => {
    const small = `function divide(a, b) {
  return a / b;
}
console.log(divide(10, 0));`;

    const budget = getReviewTokenBudget(small, 16_384);
    expect(budget.maxOutputTokens).toBe(16_384);
    expect(budget.maxIssues).toBeGreaterThan(0);
  });

  it('defaults to 16k when configured max is zero', () => {
    const budget = getReviewTokenBudget('const x = 1;', 0);
    expect(budget.maxOutputTokens).toBe(16_384);
  });
});
