import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { contractName, pages, selectGuide, setupScenario, visit } from './setup.ts';

const directory = process.env.SCREENSHOT_DIR;
test.skip(!directory, 'SCREENSHOT_DIR is required for screenshot capture');

test('画面と編集状態を撮影する', async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(resolve(directory!), { recursive: true });
  await setupScenario(page);
  async function capture(page: Page, name: string, state: string, width: number, theme: string) {
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: resolve(directory!, `${name}-${state}-${width}-${theme}.png`),
      fullPage: true, animations: 'disabled', caret: 'hide',
      // Mask only timestamps; keep sync errors and success/failure states visible.
      mask: [page.getByRole('region', { name: 'データ同期' }).locator('time')],
    });
  }
  for (const { width, theme } of [
    { width: 1440, theme: 'light' }, { width: 1440, theme: 'dark' }, { width: 390, theme: 'light' },
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    // Reload to clear transient save/sync notices between runs.
    await page.goto('/');
    for (const key of Object.keys(pages) as (keyof typeof pages)[]) {
      if (key === 'invoice-guide') await selectGuide(page);
      else await visit(page, key);
      if (key === 'projects') {
        await page.getByRole('checkbox', { name: 'アーカイブした案件も表示', exact: true }).check();
        await expect(page.getByRole('rowheader', { name: '旧サイト保守', exact: true })).toBeVisible();
      }
      await capture(page, key, 'default', width, theme);
    }
    await visit(page, 'contracts');
    await page.getByRole('button', { name: `${contractName} を編集`, exact: true }).click();
    await expect(page.getByRole('form', { name: `${contractName} を編集`, exact: true })).toBeVisible();
    await capture(page, 'contracts', 'edit', width, theme);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await page.getByRole('button', { name: `${contractName} の月ごとの目安時間`, exact: true }).click();
    await expect(page.getByRole('table', { name: '月ごとの目安時間', exact: true })).toBeVisible();
    await capture(page, 'contracts', 'overrides', width, theme);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    if (width === 390) {
      await visit(page, 'dashboard');
      await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
      await capture(page, 'dashboard', 'menu', width, theme);
    }
  }
});
