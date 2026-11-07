import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createSolidtimeClient, SolidtimeApiError } from "../src/index.ts";
import members from "./fixtures/members.json" with { type: "json" };
import organization from "./fixtures/organization.json" with { type: "json" };
import projectMembers from "./fixtures/project-members.json" with { type: "json" };
import entries from "./fixtures/time-entries-all-members.json" with { type: "json" };
import projects from "./fixtures/projects-list.json" with { type: "json" };

const BASE = "https://solidtime.test";
const ORG = organization.data.id;
const API = `${BASE}/api/v1/organizations/${ORG}`;
const ME = members.data[0]!.id;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const client = () => createSolidtimeClient({
  baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo",
});
function serve(rate: number | null = null) {
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ ...projects, data: [{ ...projects.data[0], billable_rate: rate }] })),
    http.get(`${API}/time-entries`, () => HttpResponse.json({ data: [{ ...entries.data[0], user_id: members.data[0]!.user_id, project_id: projects.data[0]!.id }], meta: { total: 1 } })),
    http.get(`${API}/members`, () => HttpResponse.json(members)),
    http.get(API, () => HttpResponse.json({ ...organization, data: { ...organization.data, billable_rate: 900000 } })),
    http.get(`${API}/projects/:project/project-members`, () => HttpResponse.json({ ...projectMembers, data: [] })),
  );
}

const ratedEntries = () => client().listTimeEntriesWithRates({ from: "2026-11-01", to: "2026-11-30" });

it("打刻のユーザーを members の後続ページから選ぶ", async () => {
  serve();
  const pages: string[] = [];
  server.use(http.get(`${API}/members`, ({ request }) => {
    const page = new URL(request.url).searchParams.get("page")!;
    pages.push(page);
    return HttpResponse.json({ ...members,
      data: page === "1" ? [members.data[1]] : [{ ...members.data[0], billable_rate: 800000 }],
      meta: { ...members.meta, current_page: Number(page), last_page: 2 },
    });
  }));
  expect((await ratedEntries())[0]?.hourlyRate).toBe(8000);
  expect(pages).toEqual(["1", "2"]);
});

it.each([0, 500025])("単価 %i は円に変換し、0 は未設定として扱わない", async (rate) => {
  serve(rate);
  expect((await client().listProjectsWithRates())[0]?.hourlyRate).toBe(rate / 100);
});

it("project member の 0 円は案件・組織単価より優先する", async () => {
  serve(500000);
  server.use(http.get(`${API}/projects/:project/project-members`, () => HttpResponse.json({
    ...projectMembers, data: [{ ...projectMembers.data[0], member_id: ME, billable_rate: 0 }],
  })));
  expect((await ratedEntries())[0]?.hourlyRate).toBe(0);
});

it("不完全な単価の応答では別の単価に黙ってフォールバックせず同期を失敗させる", async () => {
  serve();
  server.use(http.get(API, () => HttpResponse.json({ data: { ...organization.data, billable_rate: "500000" } })));
  await expect(client().listProjectsWithRates()).rejects.toBeInstanceOf(SolidtimeApiError);
});

it("project members は打刻のある案件だけを一度ずつ読む", async () => {
  serve(500000);
  const requested: string[] = [];
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ ...projects, data: [projects.data[0], { ...projects.data[0], id: "unused" }] })),
    http.get(`${API}/time-entries`, () => HttpResponse.json({ data: [
      { ...entries.data[0], id: "e1", user_id: members.data[0]!.user_id, project_id: projects.data[0]!.id },
      { ...entries.data[0], id: "e2", user_id: members.data[1]!.user_id, project_id: projects.data[0]!.id },
      { ...entries.data[0], id: "running", end: null, duration: null, project_id: "unused" },
    ], meta: { total: 3 } })),
    http.get(`${API}/projects/:id/project-members`, ({ params }) => {
      requested.push(String(params.id));
      return HttpResponse.json({ ...projectMembers, data: [] });
    }),
  );
  expect(await ratedEntries()).toHaveLength(2);
  expect(requested).toEqual([projects.data[0]!.id]);
});

it.each([
  { projectRate: 500000, organizationRate: 900000, expected: 5000 },
  { projectRate: 0, organizationRate: 900000, expected: 0 },
  { projectRate: null, organizationRate: 900000, expected: 9000 },
  { projectRate: null, organizationRate: null, expected: null },
])("member が見つからなければユーザー単価を飛ばし、案件 $projectRate → 組織 $organizationRate の順にする", async ({ projectRate, organizationRate, expected }) => {
  serve(projectRate);
  server.use(
    http.get(`${API}/members`, () => HttpResponse.json({
      ...members, data: [{ ...members.data[1], billable_rate: 800000 }],
    })),
    http.get(`${API}/projects/:project/project-members`, () => HttpResponse.json({
      ...projectMembers, data: [{ ...projectMembers.data[0], member_id: ME, billable_rate: 600000 }],
    })),
    http.get(API, () => HttpResponse.json({ ...organization, data: { ...organization.data, billable_rate: organizationRate } })),
  );
  await expect(ratedEntries()).resolves.toMatchObject([{ hourlyRate: expected }]);
});

it.each(["members", "projects/project/project-members"])("%s の単価が不正なら同期を失敗させる", async (path) => {
  serve();
  const endpoint = path === "members" ? `${API}/members` : `${API}/projects/:id/project-members`;
  server.use(http.get(endpoint, () => HttpResponse.json({ ...members,
    data: [{ ...members.data[0], member_id: ME, billable_rate: "500000" }],
  })));
  await expect(ratedEntries()).rejects.toBeInstanceOf(SolidtimeApiError);
});

it("組織でのユーザーの 0 円も組織単価より優先し、次の呼び出しでは新しい単価を読む", async () => {
  serve();
  server.use(http.get(`${API}/members`, () => HttpResponse.json({ ...members, data: [{ ...members.data[0], billable_rate: 0 }] })));
  const c = client();
  const range = { from: "2026-11-01", to: "2026-11-30" };
  expect((await c.listTimeEntriesWithRates(range))[0]?.hourlyRate).toBe(0);
  server.use(http.get(`${API}/members`, () => HttpResponse.json({ ...members, data: [{ ...members.data[0], billable_rate: 700025 }] })));
  expect((await c.listTimeEntriesWithRates(range))[0]?.hourlyRate).toBe(7000.25);
});
