import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSolidtimeClient } from "../src/index.ts";
import members from "./fixtures/members.json" with { type: "json" };
import organization from "./fixtures/organization.json" with { type: "json" };
import projectMembers from "./fixtures/project-members.json" with { type: "json" };
import projectsList from "./fixtures/projects-list.json" with { type: "json" };

// 単価の決め方(solidtime と同じ順): その案件での自分 → 案件 → 組織での自分 → 組織
// フィクスチャの形は 2026-11-07 に Sandbox 組織で記録した実際のレスポンス。値はケースごとに差し替える
const BASE = "https://solidtime.test";
const ORG = "3f0aff22-3659-4916-9828-38f3aa7f4c23";
const API = `${BASE}/api/v1/organizations/${ORG}`;
const ME = members.data[0]!.id;
const OTHER = members.data[1]!.id;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = () =>
  createSolidtimeClient({ baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo", memberId: ME });

const projectTemplate = projectsList.data[0]!;
const project = (id: string, billableRate: number | null, over: Record<string, unknown> = {}) => ({
  ...projectTemplate,
  id,
  name: `案件 ${id}`,
  billable_rate: billableRate,
  ...over,
});
const projectMember = (projectId: string, memberId: string, billableRate: number | null) => ({
  ...projectMembers.data[0]!,
  id: `${projectId}-${memberId}`,
  project_id: projectId,
  member_id: memberId,
  billable_rate: billableRate,
});

/** 各 API の応答を組み立てる。projectMembersOf は案件の id → その案件のメンバー */
const serve = (options: {
  projects: unknown[];
  projectMembersOf?: Record<string, unknown[]>;
  myRate?: number | null;
  orgRate?: number | null;
}) =>
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ ...projectsList, data: options.projects })),
    http.get(`${API}/projects/:id/project-members`, ({ params }) =>
      HttpResponse.json({ ...projectMembers, data: options.projectMembersOf?.[String(params.id)] ?? [] }),
    ),
    http.get(`${API}/members`, () =>
      HttpResponse.json({
        ...members,
        data: members.data.map((m) => ({ ...m, billable_rate: m.id === ME ? (options.myRate ?? null) : 999_900 })),
      }),
    ),
    http.get(API, () => HttpResponse.json({ ...organization, data: { ...organization.data, billable_rate: options.orgRate ?? null } })),
  );

describe("listProjectsWithRates: 案件ごとの今の単価(円/時間)", () => {
  it("その案件での自分の単価が、案件の単価より先", async () => {
    serve({ projects: [project("A", 500_000)], projectMembersOf: { A: [projectMember("A", ME, 600_000)] } });
    const [a] = await client().listProjectsWithRates();
    expect(a).toMatchObject({ id: "A", name: "案件 A", hourlyRate: 6_000 });
  });

  it("project members の 2 ページ目の自分の単価を使う", async () => {
    serve({ projects: [project("A", 500_000)], myRate: 800_000, orgRate: 900_000 });
    const pages: number[] = [];
    server.use(http.get(`${API}/projects/A/project-members`, ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get("page"));
      pages.push(page);
      return HttpResponse.json({
        ...projectMembers,
        data: [page === 1 ? projectMember("A", OTHER, 700_000) : projectMember("A", ME, 600_025)],
        meta: { ...projectMembers.meta, current_page: page, last_page: 2, total: 2 },
      });
    }));
    expect((await client().listProjectsWithRates())[0]!.hourlyRate).toBe(6_000.25);
    expect(pages).toEqual([1, 2]);
  });

  it("その案件に自分の単価がなければ、案件の単価", async () => {
    serve({
      projects: [project("A", 500_000)],
      projectMembersOf: { A: [projectMember("A", ME, null), projectMember("A", OTHER, 700_000)] },
      myRate: 800_000,
      orgRate: 900_000,
    });
    expect((await client().listProjectsWithRates())[0]!.hourlyRate).toBe(5_000);
  });

  it("案件の単価もなければ、組織での自分の単価(ほかのメンバーの単価は使わない)", async () => {
    serve({ projects: [project("A", null)], projectMembersOf: { A: [projectMember("A", OTHER, 700_000)] }, myRate: 800_000 });
    expect((await client().listProjectsWithRates())[0]!.hourlyRate).toBe(8_000);
  });

  it("自分の単価もなければ組織の単価、どれもなければ null", async () => {
    serve({ projects: [project("A", null)], orgRate: 900_000 });
    expect((await client().listProjectsWithRates())[0]!.hourlyRate).toBe(9_000);
    server.resetHandlers();
    serve({ projects: [project("A", null)] });
    expect((await client().listProjectsWithRates())[0]!.hourlyRate).toBeNull();
  });

  it("取引先とアーカイブも返す", async () => {
    serve({
      projects: [project("A", 500_000, { client_id: "client-1", is_archived: true }), project("B", 500_000, { client_id: null })],
    });
    const [a, b] = await client().listProjectsWithRates();
    expect(a).toMatchObject({ clientId: "client-1", isArchived: true });
    expect(b).toMatchObject({ clientId: null, isArchived: false });
  });
});

describe("solidtime には書き込まない", () => {
  it("書き込みのメソッドを持たない", () => {
    const c = client() as unknown as Record<string, unknown>;
    for (const name of ["createClient", "createProject", "setProjectRate"]) expect(c[name], name).toBeUndefined();
  });

  it("どの読み取りでも GET 以外を送らない", async () => {
    const methods: string[] = [];
    server.events.on("request:start", ({ request }) => methods.push(request.method));
    serve({ projects: [project("A", 500_000)] });
    await client().listProjectsWithRates();
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    server.events.removeAllListeners();
  });
});
