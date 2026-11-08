import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function todayInTokyo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function createDataset(today = todayInTokyo()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(`${today}T00:00:00Z`).toISOString().slice(0, 10) !== today) {
    throw new Error('E2E_TODAY must be YYYY-MM-DD');
  }
  const organization = { id: 'e2e-org', name: 'E2E', billable_rate: null, currency: 'JPY' };
  const clients = [
    { id: 'client-a', name: 'テスト商事', is_archived: false },
    { id: 'client-b', name: 'サンプル企画', is_archived: false },
  ];
  const members = [1, 2].map(n => ({ id: `member-${n}`, user_id: `user-${n}`, name: `担当者 ${n}`, email: `member${n}@example.com`, role: 'admin', billable_rate: null }));
  const projects = [
    { id: 'project-a', name: 'Web サイト改善', client_id: 'client-a', billable_rate: 600000, is_archived: false },
    { id: 'project-b', name: '業務調査', client_id: 'client-b', billable_rate: null, is_archived: false },
    { id: 'project-c', name: '旧サイト保守', client_id: 'client-a', billable_rate: 400000, is_archived: true },
  ].map(p => ({ ...p, color: '#2563eb', is_billable: true, is_public: false, estimated_time: null }));
  const projectMembers = [{ id: 'project-member-2', project_id: 'project-a', member_id: 'member-2', billable_rate: 800000 }];
  const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() - 1);
  const entries = [];
  for (const day = first; day.toISOString().slice(0, 10) <= today; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    for (const [project, user, duration, hour] of [
      ['project-a', 'user-1', 3600, 1], ['project-a', 'user-2', 1800, 2],
      ['project-b', 'user-1', 1800, 3], ['project-c', 'user-2', 900, 4],
    ]) {
      const start = `${date}T${String(hour).padStart(2, '0')}:00:00Z`;
      entries.push({ id: `${date}-${project}-${user}`, organization_id: organization.id,
        project_id: project, user_id: user, start, end: new Date(Date.parse(start) + duration * 1000).toISOString(),
        duration, description: '作業記録', task_id: null, tags: [], billable: true, type: 'work' });
    }
  }
  return { organization, clients, members, projects, projectMembers, entries };
}

export function createFakeSolidtime({ today = todayInTokyo() } = {}) {
  const data = createDataset(today);
  return createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url, 'http://solidtime:8081');
    if (request.method !== 'GET') return reply(405, { message: 'GET only' });
    if (url.pathname === '/health') return reply(200, { ok: true });
    if (request.headers.authorization !== 'Bearer e2e-solidtime-token') return reply(401, { message: 'Unauthorized' });
    const prefix = '/api/v1/organizations/e2e-org';
    if (url.pathname === prefix) return reply(200, { data: data.organization });
    if (!url.pathname.startsWith(`${prefix}/`)) return reply(404, { message: 'Unknown organization or path' });
    const path = url.pathname.slice(prefix.length + 1);
    if (path === 'time-entries') {
      const start = Date.parse(url.searchParams.get('start'));
      const end = Date.parse(url.searchParams.get('end'));
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || !url.searchParams.has('offset')) {
        return reply(400, { message: 'Expected start, end, limit (1..500), offset' });
      }
      // Match the adapter's inclusive timestamp range and raw-row offsets.
      const rows = data.entries.filter(row => Date.parse(row.start) >= start && Date.parse(row.start) <= end);
      return reply(200, { data: rows.slice(offset, offset + limit), meta: { total: rows.length } });
    }
    let rows = { clients: data.clients, projects: data.projects, members: data.members }[path];
    const project = /^projects\/([^/]+)\/project-members$/.exec(path)?.[1];
    if (project && data.projects.some(p => p.id === project)) rows = data.projectMembers.filter(row => row.project_id === project);
    if (!rows) return reply(404, { message: 'Unknown resource' });
    const page = Number(url.searchParams.get('page'));
    // Small pages exercise real resource pagination on every sync.
    const pageSize = 2;
    const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
    if (!Number.isInteger(page) || page < 1 || page > lastPage) return reply(400, { message: 'Invalid page' });
    reply(200, { data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { current_page: page, last_page: lastPage, per_page: pageSize, total: rows.length } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFakeSolidtime({ today: process.env.E2E_TODAY ?? todayInTokyo() });
  server.listen(Number(process.env.PORT ?? 8081), '0.0.0.0', () => console.log('Fake solidtime listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
