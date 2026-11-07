import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSolidtimeClient } from "../src/index.ts";
import allMembersEntries from "./fixtures/time-entries-all-members.json" with { type: "json" };
import members from "./fixtures/members.json" with { type: "json" };
import organization from "./fixtures/organization.json" with { type: "json" };
import projectMembers from "./fixtures/project-members.json" with { type: "json" };
import projectsList from "./fixtures/projects-list.json" with { type: "json" };

// 打刻はユーザーで絞らず、全員分を取り込む(会社専用のユーザーも自分)。単価は打刻ごとに、
// その打刻のユーザーで solidtime と同じ順に決める: その案件でのユーザー → 案件 → 組織でのユーザー → 組織
// フィクスチャの形は 2026-11-07 に Sandbox 組織で記録した実際のレスポンス。値はケースごとに差し替える
const BASE = "https://solidtime.test";
const ORG = "3f0aff22-3659-4916-9828-38f3aa7f4c23";
const API = `${BASE}/api/v1/organizations/${ORG}`;
const [MEMBER_1, MEMBER_2] = members.data;
const U1 = MEMBER_1!.user_id;
const U2 = MEMBER_2!.user_id;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = () => createSolidtimeClient({ baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo" });

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
const entryTemplate = allMembersEntries.data[0]!;
/** 2026-11-02 10:00〜11:00 JST の 1 時間の打刻 */
const entry = (id: string, userId: string, projectId: string | null) => ({
  ...entryTemplate,
  id,
  user_id: userId,
  project_id: projectId,
  start: "2026-11-02T01:00:00Z",
  end: "2026-11-02T02:00:00Z",
  duration: 3_600,
  billable: true,
});

const requested: URL[] = [];
afterEach(() => {
  requested.length = 0;
});

const serve = (options: {
  projects: unknown[];
  entries?: unknown[];
  projectMembersOf?: Record<string, unknown[]>;
  memberRates?: Record<string, number | null>;
  orgRate?: number | null;
}) =>
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ ...projectsList, data: options.projects })),
    http.get(`${API}/projects/:id/project-members`, ({ params }) =>
      HttpResponse.json({ ...projectMembers, data: options.projectMembersOf?.[String(params.id)] ?? [] }),
    ),
    http.get(`${API}/members`, () =>
      HttpResponse.json({ ...members, data: members.data.map((m) => ({ ...m, billable_rate: options.memberRates?.[m.id] ?? null })) }),
    ),
    http.get(API, () => HttpResponse.json({ ...organization, data: { ...organization.data, billable_rate: options.orgRate ?? null } })),
    http.get(`${API}/time-entries`, ({ request }) => {
      requested.push(new URL(request.url));
      const data = options.entries ?? [];
      return HttpResponse.json({ ...allMembersEntries, data, meta: { ...allMembersEntries.meta, total: data.length } });
    }),
  );

const ratesOf = async () =>
  Object.fromEntries((await client().listTimeEntriesWithRates({ from: "2026-11-01", to: "2026-11-30" })).map((e) => [e.id, e.hourlyRate]));

describe("listTimeEntriesWithRates: 全ユーザーの打刻と、打刻ごとの単価", () => {
  it("ユーザーで絞らない(member_id を付けず、自分のメンバーシップも引かない)", async () => {
    serve({ projects: [project("A", 500_000)], entries: [entry("e1", U1, "A"), entry("e2", U2, "A")] });
    const entries = await client().listTimeEntriesWithRates({ from: "2026-11-01", to: "2026-11-30" });
    expect(entries.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(requested.every((url) => !url.searchParams.has("member_id"))).toBe(true);
  });

  it("記録した実際の応答(2 人のユーザーの打刻)を読める", async () => {
    serve({ projects: [project(entryTemplate.project_id!, 500_000)], entries: allMembersEntries.data });
    const entries = await client().listTimeEntriesWithRates({ from: "2026-11-01", to: "2026-11-30" });
    expect(new Set(entries.map((e) => e.userId))).toEqual(new Set(allMembersEntries.data.map((e) => e.user_id)));
    expect(entries.every((e) => e.hourlyRate === 5_000)).toBe(true);
  });

  it("その案件でのそのユーザーの単価が先。ほかのユーザーの打刻には使わない", async () => {
    serve({
      projects: [project("A", 500_000)],
      entries: [entry("e1", U1, "A"), entry("e2", U2, "A")],
      projectMembersOf: { A: [projectMember("A", MEMBER_1!.id, 600_000)] },
    });
    await expect(ratesOf()).resolves.toEqual({ e1: 6_000, e2: 5_000 });
  });

  it("案件の単価がなければ、組織でのそのユーザーの単価。それもなければ組織の単価", async () => {
    serve({
      projects: [project("A", null)],
      entries: [entry("e1", U1, "A"), entry("e2", U2, "A")],
      memberRates: { [MEMBER_1!.id]: 800_025 },
      orgRate: 900_000,
    });
    await expect(ratesOf()).resolves.toEqual({ e1: 8_000.25, e2: 9_000 });
  });

  it("どれも設定されていなければ null", async () => {
    serve({ projects: [project("A", null)], entries: [entry("e1", U1, "A")] });
    await expect(ratesOf()).resolves.toEqual({ e1: null });
  });

  it("プロジェクトのない打刻は、組織でのユーザー → 組織の順", async () => {
    serve({ projects: [], entries: [entry("e1", U1, null), entry("e2", U2, null)], memberRates: { [MEMBER_1!.id]: 700_000 }, orgRate: 900_000 });
    await expect(ratesOf()).resolves.toEqual({ e1: 7_000, e2: 9_000 });
  });

  it("project members の 2 ページ目にいるユーザーの単価も使う", async () => {
    serve({ projects: [project("A", 500_000)], entries: [entry("e1", U1, "A")] });
    server.use(
      http.get(`${API}/projects/A/project-members`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json({
          ...projectMembers,
          data: [page === 1 ? projectMember("A", MEMBER_2!.id, 700_000) : projectMember("A", MEMBER_1!.id, 600_025)],
          meta: { ...projectMembers.meta, current_page: page, last_page: 2, total: 2 },
        });
      }),
    );
    await expect(ratesOf()).resolves.toEqual({ e1: 6_000.25 });
  });

  it("project members は、打刻のある案件ごとに各ページを 1 回ずつ引く(ユーザーや打刻が多くても増えない)", async () => {
    serve({
      projects: [project("A", 500_000)],
      entries: [entry("e1", U1, "A"), entry("e2", U2, "A"), entry("e3", U1, "A")],
    });
    const pages: number[] = [];
    server.use(
      http.get(`${API}/projects/A/project-members`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        pages.push(page);
        return HttpResponse.json({
          ...projectMembers,
          data: [page === 1 ? projectMember("A", MEMBER_2!.id, 700_000) : projectMember("A", MEMBER_1!.id, 600_000)],
          meta: { ...projectMembers.meta, current_page: page, last_page: 2, total: 2 },
        });
      }),
    );
    await expect(ratesOf()).resolves.toEqual({ e1: 6_000, e2: 7_000, e3: 6_000 });
    expect(pages).toEqual([1, 2]);
  });
});

describe("listProjectsWithRates: 案件の単価(ユーザーによらない。案件 → 組織)", () => {
  it("案件の単価、なければ組織の単価、どちらもなければ null。メンバーの単価は使わない", async () => {
    serve({
      projects: [project("A", 500_000), project("B", null)],
      projectMembersOf: { A: [projectMember("A", MEMBER_1!.id, 600_000)] },
      memberRates: { [MEMBER_1!.id]: 800_000 },
      orgRate: 900_000,
    });
    const projects = await client().listProjectsWithRates();
    expect(projects.map((p) => [p.id, p.hourlyRate])).toEqual([
      ["A", 5_000],
      ["B", 9_000],
    ]);
    server.resetHandlers();
    serve({ projects: [project("B", null)] });
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
    serve({ projects: [project("A", 500_000)], entries: [entry("e1", U1, "A")] });
    await client().listProjectsWithRates();
    await client().listTimeEntriesWithRates({ from: "2026-11-01", to: "2026-11-30" });
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    server.events.removeAllListeners();
  });
});

describe("listTimeEntriesWithRates: members にいないユーザーの打刻", () => {
  it("同期を止めず、ユーザーの単価を飛ばして案件 → 組織の順にする", async () => {
    serve({
      projects: [project("A", 500_000), project("B", null)],
      entries: [entry("e1", "removed-user", "A"), entry("e2", "removed-user", "B"), entry("e3", U1, "A")],
      memberRates: { [MEMBER_1!.id]: 800_000 },
      orgRate: 900_000,
    });
    await expect(ratesOf()).resolves.toEqual({ e1: 5_000, e2: 9_000, e3: 5_000 });
  });
});

describe("currentRates: 同期時点の単価", () => {
  it("打刻を取得せず、入力順に案件ユーザー → 案件 → ユーザー → 組織の単価を返す", async () => {
    serve({
      projects: [project("A", 500_000), project("B", null)],
      projectMembersOf: { A: [projectMember("A", MEMBER_1!.id, 0)] },
      memberRates: { [MEMBER_1!.id]: 800_025 }, orgRate: 900_000,
    });
    const c = client();
    await expect(c.currentRates([
      { projectId: "B", userId: U2 }, { projectId: "A", userId: U1 },
      { projectId: "A", userId: U2 }, { projectId: "B", userId: U1 },
      { projectId: "A", userId: "removed" }, { projectId: "B", userId: "removed" },
    ])).resolves.toEqual([9000, 0, 5000, 8000.25, 5000, 9000]);
    expect(requested).toEqual([]);
    server.resetHandlers();
    serve({ projects: [project("B", null)] });
    await expect(c.currentRates([{ projectId: "B", userId: U1 }])).resolves.toEqual([null]);
  });

  it.each([false, true])("打刻取得時の情報を再利用し、履歴にだけある案件のメンバーも一度だけ取得する(打刻なし: %s)", async (empty) => {
    serve({
      projects: [project("A", 500_000), project("B", null)],
      entries: empty ? [] : [entry("e1", U1, "A"), entry("e2", U2, "A")],
      projectMembersOf: { A: [projectMember("A", MEMBER_1!.id, 600_000)], B: [projectMember("B", MEMBER_2!.id, 700_025)] },
      orgRate: 900_000,
    });
    const fetcher = vi.fn<typeof fetch>((input, init) => fetch(input, init));
    const c = createSolidtimeClient({ baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo", fetch: fetcher });
    const range = { from: "2026-11-01", to: "2026-11-30" };
    await c.listTimeEntriesWithRates(range);
    expect((await c.listProjectsWithRates()).map((p) => p.hourlyRate)).toEqual([5000, 9000]);
    const pairs = [{ projectId: "B", userId: U2 }, { projectId: "A", userId: U1 }, { projectId: "B", userId: U2 }];
    expect(await c.currentRates(pairs)).toEqual([7000.25, 6000, 7000.25]);
    const paths = fetcher.mock.calls.map(([url]) => String(url).replace(API, ""));
    expect(paths).toHaveLength(6);
    expect(paths.filter((path) => !path.startsWith("/time-entries?")).sort()).toEqual([
      "", "/members?page=1", "/projects?page=1", "/projects/A/project-members?page=1", "/projects/B/project-members?page=1",
    ].sort());
    // Even an empty next sync must refresh the shared information.
    server.resetHandlers();
    serve({ projects: [project("A", null), project("B", null)], memberRates: { [MEMBER_1!.id]: 800_025 }, orgRate: 400_000 });
    await c.listTimeEntriesWithRates(range);
    expect((await c.listProjectsWithRates()).map((p) => p.hourlyRate)).toEqual([4000, 4000]);
    expect(await c.currentRates(pairs)).toEqual([4000, 8000.25, 4000]);
  });

  it("単価取得の失敗後は、次の同期で取り直す", async () => {
    serve({ projects: [project("A", null)] });
    server.use(http.get(`${API}/members`, () => HttpResponse.json({ message: "Forbidden" }, { status: 403 })));
    const c = client();
    const range = { from: "2026-11-01", to: "2026-11-30" };
    await expect(c.listTimeEntriesWithRates(range)).rejects.toThrow();
    server.resetHandlers();
    serve({ projects: [project("A", 500_000)] });
    await c.listTimeEntriesWithRates(range);
    await expect(c.currentRates([{ projectId: "A", userId: U1 }])).resolves.toEqual([5000]);
  });
});
