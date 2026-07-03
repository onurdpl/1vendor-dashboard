import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const financeQueuePages = [
  'src/pages/AdminSettlementApprovalsPage.tsx',
  'src/pages/AdminScheduledSettlementsPage.tsx',
  'src/pages/AdminRefundAdjustmentsPage.tsx',
  'src/pages/AdminPaymentPreparationPage.tsx',
];

function readProjectFile(path: string) {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

function getStyleBlock(styles: string, selector: string) {
  const start = styles.indexOf(selector);
  const end = styles.indexOf('}', start);
  return start >= 0 && end > start ? styles.slice(start, end + 1) : '';
}

describe('Admin Finance queue consistency', () => {
  it('keeps queue pages on the shared header and queue IA', () => {
    financeQueuePages.forEach((path) => {
      const source = readProjectFile(path);
      expect(source).toContain('ADMIN FINANCE');
      expect(source).toContain('settlement-review-queue');
      expect(source).toContain('settlement-review-filters');
      expect(source).toContain('settlement-review-layout');
      expect(source).toContain('settlement-review-panel');
      expect(source).not.toContain('Settlement Review Queue');
      expect(source).not.toContain('No timeline event yet');
      expect(source).not.toContain('No Action Required');
      expect(source).not.toContain('Ready for Draft');
      expect(source).not.toContain('None / Ready');
    });
  });

  it('keeps admin finance queue tables buttonless and row-selectable', () => {
    financeQueuePages.forEach((path) => {
      const source = readProjectFile(path);
      expect(source).not.toMatch(/columns=\{\[[^\]]*['"]Review['"]/);
      expect(source).not.toMatch(/columns=\{\[[^\]]*['"]Open['"]/);
      expect(source).not.toMatch(/<button[^>]*className="[^"]*settlement-review-row-action[^"]*"[^>]*>/);
      expect(source).toContain('onSelect=');
    });
  });

  it('keeps queue grids and badges wrap-safe', () => {
    const styles = readProjectFile('src/styles.css');
    const tableGridSelectors = [
      '.settlement-review-table .op-table-head',
      '.scheduled-settlements-table .op-table-head',
      '.refund-adjustments-table .op-table-head',
      '.payment-preparation-table .op-table-head',
    ];

    tableGridSelectors.forEach((selector) => {
      const block = getStyleBlock(styles, selector);
      expect(block).toContain('minmax(0,');
      expect(block).not.toMatch(/minmax\(\d+px/);
    });

    const layoutBlock = getStyleBlock(styles, '.settlement-review-layout');
    expect(layoutBlock).toContain('min-width: 0;');
    expect(layoutBlock).toContain('overflow: hidden;');

    const issueListBlock = getStyleBlock(styles, '.settlement-review-issue-list');
    expect(issueListBlock).toContain('flex-wrap: wrap;');
    expect(issueListBlock).toContain('gap: 5px 6px;');
    expect(issueListBlock).toContain('min-width: 0;');

    const issueBadgeBlock = getStyleBlock(styles, '.settlement-review-issue-list .op-badge');
    expect(issueBadgeBlock).toContain('white-space: normal;');
    expect(issueBadgeBlock).toContain('overflow-wrap: anywhere;');
    expect(issueBadgeBlock).not.toContain('white-space: nowrap;');
  });
});
