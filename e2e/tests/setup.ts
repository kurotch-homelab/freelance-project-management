import { expect, type Page } from '@playwright/test';

const today = process.env.E2E_TODAY ?? new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const previous = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
previous.setUTCDate(0);
export const previousMonth = previous.toISOString().slice(0, 7);
export const previousMonthDays = previous.getUTCDate();
export const currentMonth = today.slice(0, 7);
export const contractName = 'Web 改善契約';

export const pages = {
  dashboard: 'ダッシュボード', clients: '取引先', projects: '案件', contracts: '契約', 'invoice-guide': '請求書ガイド',
} as const;

export async function visit(page: Page, key: keyof typeof pages) {
  await expect(page.getByRole('main')).toBeVisible();
  const link = page.getByRole('link', { name: pages[key], exact: true });
  if (!await link.isVisible()) await page.getByRole('button', { name: 'メニューを開く', exact: true }).click();
  await link.click();
  await expect(page.getByRole('heading', { name: pages[key], level: 1 })).toBeVisible();
  if (key === 'dashboard') await expect(page.getByRole('region', { name: 'データ同期' })).toBeVisible();
  else if (key === 'invoice-guide') await expect(page.getByRole('combobox', { name: '取引先', exact: true })).toBeEnabled();
  else await expect(page.getByRole('table', { name: pages[key], exact: true })).toBeVisible();
  await expect(page.getByText(/読み込んでいます…|見込みを更新中です…/)).toHaveCount(0);
}

export async function selectGuide(page: Page, client = 'テスト商事') {
  await visit(page, 'invoice-guide');
  await page.getByRole('textbox', { name: '対象月', exact: true }).fill(previousMonth);
  await page.getByRole('combobox', { name: '取引先', exact: true }).selectOption({ label: client });
  await expect(page.getByRole('heading', { name: `${client} の請求内容`, exact: true })).toBeVisible();
  await expect(page.getByText('請求書ガイドを読み込んでいます…', { exact: true })).toHaveCount(0);
}

export async function setupScenario(page: Page) {
  // Exercise the actual authorization-code flow, including the mock IdP form.
  await page.goto('/auth/login');
  await expect(page).toHaveURL(/^http:\/\/oidc:8080\/e2e\//);
  await page.getByPlaceholder('Enter any user/subject').fill('e2e-user');
  await page.getByRole('button', { name: 'Sign-in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible();

  // Startup sync runs immediately. Wait for it before testing the manual sync.
  await expect.poll(async () => {
    const response = await page.request.get('/api/dashboard');
    if (!response.ok()) return false;
    const dashboard = await response.json();
    return dashboard.sync.solidtime.lastSuccessAt !== null && dashboard.sync.calendar.lastFailure !== null;
  }).toBe(true);
  await page.getByRole('button', { name: 'solidtime を同期', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'solidtime を同期しました' })).toBeVisible();

  await visit(page, 'clients');
  await page.getByRole('button', { name: 'テスト商事 の請求の設定を変える', exact: true }).click();
  const billing = page.getByRole('form', { name: 'テスト商事 の請求の設定を変える', exact: true });
  await billing.getByRole('combobox', { name: '締め日', exact: true }).selectOption('end');
  await billing.getByRole('combobox', { name: '支払月', exact: true }).selectOption('1');
  await billing.getByRole('combobox', { name: '支払日', exact: true }).selectOption('end');
  await billing.getByRole('textbox', { name: '件名のひな形', exact: true }).fill('{YYYY}年{M}月 業務委託費');
  await billing.getByRole('combobox', { name: '明細のまとめ方', exact: true }).selectOption('contract');
  await billing.getByRole('button', { name: '保存', exact: true }).click();
  await expect(billing).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();

  await visit(page, 'contracts');
  for (const contract of [
    { name: contractName, client: 'テスト商事', project: 'Web サイト改善', start: `${previousMonth}-01` },
    // Distinct start dates preserve ordering without changing random ID creation.
    { name: '業務調査契約', client: 'サンプル企画', project: '業務調査', start: `${previousMonth}-02` },
  ]) {
    const edit = page.getByRole('button', { name: `${contract.name} を編集`, exact: true });
    const existing = await edit.count() > 0;
    await (existing ? edit : page.getByRole('button', { name: '契約を追加', exact: true })).click();
    const form = page.getByRole('form', { name: existing ? `${contract.name} を編集` : '契約を追加', exact: true });
    if (!existing) await form.getByRole('combobox', { name: '取引先', exact: true }).selectOption({ label: contract.client });
    await form.getByRole('textbox', { name: '名前', exact: true }).fill(contract.name);
    // Native date inputs have no implicit ARIA role; use their accessible label.
    await form.getByLabel('開始日', { exact: true }).fill(contract.start);
    await form.getByRole('checkbox', { name: contract.project, exact: true }).check();
    await form.getByRole('spinbutton', { name: '月の下限(時間)', exact: true }).fill('40');
    await form.getByRole('spinbutton', { name: '月の上限(時間)', exact: true }).fill('80');
    await form.getByRole('combobox', { name: '更新の見込み', exact: true }).selectOption('likely');
    await form.getByRole('button', { name: '保存', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('button', { name: `${contract.name} を編集`, exact: true })).toBeEnabled();
  }
  await page.getByRole('button', { name: `${contractName} の月ごとの目安時間`, exact: true }).click();
  const overrides = page.getByRole('region', { name: `${contractName} の月ごとの目安時間`, exact: true });
  await overrides.getByRole('textbox', { name: '対象月', exact: true }).fill(currentMonth);
  await overrides.getByRole('spinbutton', { name: '下限(時間)', exact: true }).fill('20');
  await overrides.getByRole('spinbutton', { name: '上限(時間)', exact: true }).fill('60');
  await overrides.getByRole('textbox', { name: 'メモ', exact: true }).fill('今月の合意時間');
  await overrides.getByRole('button', { name: '上書きを追加', exact: true }).click();
  await expect(overrides.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
  await expect(overrides.getByRole('row', { name: new RegExp(`${currentMonth} 契約全体 20 時間 60 時間`) })).toBeVisible();
  await overrides.getByRole('button', { name: '閉じる', exact: true }).click();
}
