import { salvageIssuesFromBuffer } from './json-salvage';

describe('salvageIssuesFromBuffer', () => {
  it('extracts complete issues from a truncated issues array', () => {
    const buffer = `{
  "summary": "Found issues",
  "language": "JavaScript",
  "issues": [
    {"severity":"high","category":"Runtime Error","title":"Divide by zero","line":3,"explanation":"b can be zero","evidence":"a / b","suggestedFix":"Guard b","confidence":90},
    {"severity":"medium","category":"Edge Case","title":"Missing validation","line":1,"explanation":"No input checks","evidence":"function divide","suggestedFix":"Validate args","confidence":85},
    {"severity":"low","category":"Best Practice","title":"Incomplete`;

    const issues = salvageIssuesFromBuffer(buffer);
    expect(issues.length).toBe(2);
    expect(issues[0].title).toBe('Divide by zero');
    expect(issues[1].title).toBe('Missing validation');
  });
});
