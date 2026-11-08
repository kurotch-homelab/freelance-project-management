import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createSolidtimeClient } from '../../packages/solidtime/src/client.ts';
import { createDataset, createFakeSolidtime } from '../../e2e/fake-solidtime/server.mjs';
import { invoiceGuide } from '../../packages/domain/src/invoice-guide.ts';

const server = createFakeSolidtime({ today: '2026-11-08' });
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

test('実際のアダプターでリソース・打刻のページングと単価を読める', async () => {
  const client = createSolidtimeClient({ baseUrl, organizationId: 'e2e-org', token: 'e2e-solidtime-token', timeZone: 'Asia/Tokyo' });
  expect(await client.listClients()).toHaveLength(2);
  const projects = await client.listProjects();
  expect(projects).toHaveLength(3);
  expect(projects.filter(project => project.isArchived)).toHaveLength(1);
  const entries = await client.listTimeEntries({ from: '2026-10-31', to: '2026-11-01', pageSize: 3 });
  expect(entries).toHaveLength(8);
  expect(new Set(entries.map(entry => entry.id)).size).toBe(8);
  expect(new Set(entries.map(entry => entry.date))).toEqual(new Set(['2026-10-31', '2026-11-01']));
  const rated = await client.listTimeEntriesWithRates({ from: '2026-11-01', to: '2026-11-01' });
  expect(rated.map(entry => entry.hourlyRate)).toEqual([6000, 8000, null, 4000]);
  expect(await client.currentRates([{ projectId: 'project-a', userId: 'user-2' }, { projectId: 'project-b', userId: 'user-1' }])).toEqual([8000, null]);
});

test('未認証、未知のパス、更新操作、不正なページ指定を拒否する', async () => {
  const path = `${baseUrl}/api/v1/organizations/e2e-org`;
  const headers = { Authorization: 'Bearer e2e-solidtime-token' };
  expect((await fetch(path)).status).toBe(401);
  expect((await fetch(`${path}/unknown`, { headers })).status).toBe(404);
  expect((await fetch(path, { method: 'POST', headers })).status).toBe(405);
  expect((await fetch(`${path}/projects?page=0`, { headers })).status).toBe(400);
  expect((await fetch(`${path}/time-entries?limit=501&offset=0`, { headers })).status).toBe(400);
});

test('撮影データから請求額と契約未設定・単価未設定の警告が出る', async () => {
  const client = createSolidtimeClient({ baseUrl, organizationId: 'e2e-org', token: 'e2e-solidtime-token', timeZone: 'Asia/Tokyo' });
  const projects = await client.listProjects();
  const entries = await client.listTimeEntriesWithRates({ from: '2026-10-01', to: '2026-10-31' });
  const guide = invoiceGuide({
    month: '2026-10',
    client: { id: 'client-a', name: 'テスト商事', subjectTemplate: '{YYYY}年{M}月 業務委託費',
      lineGrouping: 'contract', paymentTerms: { closingDay: 'end', paymentMonthOffset: 1, paymentDay: 'end' } },
    contracts: [{ id: 'contract-a', name: 'Web 改善契約', clientId: 'client-a', projectIds: ['project-a'],
      start: '2026-10-01', end: null, renewalOutlook: 'likely' }],
    projects: projects.filter(project => project.clientId === 'client-a').map(project => ({
      ...project, work: entries.filter(entry => entry.projectId === project.id),
    })),
  });
  expect(guide?.total).toBe(31 * 12_100);
  expect(guide?.lines).toHaveLength(3);
  expect(guide?.warnings).toEqual([{ kind: 'missingContract', projectId: 'project-c', projectName: '旧サイト保守', seconds: 31 * 900 }]);
  const unpriced = invoiceGuide({
    month: '2026-10',
    client: { id: 'client-b', name: 'サンプル企画', subjectTemplate: '{M}月分', lineGrouping: 'project',
      paymentTerms: { closingDay: 'end', paymentMonthOffset: 1, paymentDay: 'end' } },
    contracts: [],
    projects: projects.filter(project => project.clientId === 'client-b').map(project => ({
      ...project, work: entries.filter(entry => entry.projectId === project.id),
    })),
  });
  expect(unpriced?.warnings[0]?.kind).toBe('missingRate');
});

test('同じ基準日は同じデータになり、年越しと閏年も扱える', () => {
  expect(createDataset('2026-11-08')).toEqual(createDataset('2026-11-08'));
  expect(createDataset('2027-01-01').entries[0]?.start).toBe('2026-12-01T01:00:00Z');
  expect(createDataset('2028-03-01').entries).toHaveLength(30 * 4);
});
