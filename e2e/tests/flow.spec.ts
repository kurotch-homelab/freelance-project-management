import { test, expect } from '@playwright/test';
import { previousMonthDays, selectGuide, setupScenario, visit } from './setup.ts';

test('ログイン、同期、請求設定、契約と月別上書き、請求書ガイド', async ({ page }) => {
  await setupScenario(page);
  await selectGuide(page);
  const guide = page.getByRole('region', { name: 'テスト商事 の請求書ガイド', exact: true });
  const total = `¥${(previousMonthDays * 12_100).toLocaleString('ja-JP')}`;
  await expect(guide.getByRole('definition').filter({ has: page.getByRole('button', { name: '税込をコピー', exact: true }) })).toContainText(total);
  await expect(guide.getByRole('table', { name: '明細', exact: true }).getByRole('row')).toHaveCount(4);
  await expect(guide.getByRole('status').filter({ hasText: /旧サイト保守: 契約に入っていない稼働/ })).toBeVisible();
  await selectGuide(page, 'サンプル企画');
  await expect(page.getByRole('status').filter({ hasText: /業務調査 の稼働のうち、単価が未設定/ })).toBeVisible();
  await visit(page, 'projects');
  await expect(page.getByRole('rowheader', { name: '旧サイト保守', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'アーカイブした案件も表示', exact: true }).check();
  await expect(page.getByRole('rowheader', { name: '旧サイト保守', exact: true })).toBeVisible();
});
