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
      expect(source).not.toContain('No action required');
      expect(source).not.toContain('Ready for Draft');
      expect(source).not.toContain('Ready for Approval');
      expect(source).not.toContain('Refund Review');
      expect(source).not.toContain('Vendor Hold');
      expect(source).not.toContain('Already Drafted');
      expect(source).not.toContain('None / Ready');
      expect(source).not.toContain('Why is this waiting?');
      expect(source).not.toMatch(/Ref: [a-z0-9]/i);
      expect(source).not.toContain('Missing Evidence');
      expect(source).not.toContain('Export Needed');
      expect(source).not.toContain('No activity recorded yet.');
      expect(source).toContain('Current Blocker');
    });
  });

  it('keeps admin finance navigation in operational workflow order', () => {
    const source = readProjectFile('src/components/AppShell.tsx');
    const settlementIndex = source.indexOf("label: 'Settlement Approvals'");
    const refundIndex = source.indexOf("label: 'Refund Adjustments'");
    const paymentIndex = source.indexOf("label: 'Payment Preparation'");
    const scheduledIndex = source.indexOf("label: 'Scheduled Settlements'");

    expect(settlementIndex).toBeGreaterThanOrEqual(0);
    expect(refundIndex).toBeGreaterThan(settlementIndex);
    expect(paymentIndex).toBeGreaterThan(refundIndex);
    expect(scheduledIndex).toBeGreaterThan(paymentIndex);
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
