import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { createSolidtimeClient, SolidtimeApiError } from "../src/index.ts";
import members from "./fixtures/members.json" with { type: "json" };
import organization from "./fixtures/organization.json" with { type: "json" };
import projectMembers from "./fixtures/project-members.json" with { type: "json" };
import projects from "./fixtures/projects-list.json" with { type: "json" };

const BASE = "https://solidtime.test";
const ORG = organization.data.id;
const API = `${BASE}/api/v1/organizations/${ORG}`;
const ME = members.data[0]!.id;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const client = (memberId?: string) => createSolidtimeClient({
  baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo", ...(memberId === undefined ? {} : { memberId }),
});
function serve(rate: number | null = null) {
  server.use(
    http.get(`${BASE}/api/v1/users/me/memberships`, () => HttpResponse.json({ data: [
      { id: "someone", organization: { id: "other" } }, { id: ME, organization: { id: ORG } },
    ] })),
    http.get(`${API}/projects`, () => HttpResponse.json({ ...projects, data: [{ ...projects.data[0], billable_rate: rate }] })),
    http.get(`${API}/members`, () => HttpResponse.json(members)),
    http.get(API, () => HttpResponse.json({ ...organization, data: { ...organization.data, billable_rate: 900000 } })),
    http.get(`${API}/projects/:project/project-members`, () => HttpResponse.json({ ...projectMembers, data: [] })),
  );
}

it("memberId がなければ memberships から自分を選び、members の後続ページも読む", async () => {
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
  expect((await client().listProjectsWithRates())[0]?.hourlyRate).toBe(8000);
  expect(pages).toEqual(["1", "2"]);
});

it.each([0, 500025])("単価 %i は円に変換し、0 は未設定として扱わない", async (rate) => {
  serve(rate);
  expect((await client(ME).listProjectsWithRates())[0]?.hourlyRate).toBe(rate / 100);
});

it("project member の 0 円は案件・組織単価より優先する", async () => {
  serve(500000);
  server.use(http.get(`${API}/projects/:project/project-members`, () => HttpResponse.json({
    ...projectMembers, data: [{ ...projectMembers.data[0], member_id: ME, billable_rate: 0 }],
  })));
  expect((await client(ME).listProjectsWithRates())[0]?.hourlyRate).toBe(0);
});

it("不完全な単価の応答では別の単価に黙ってフォールバックせず同期を失敗させる", async () => {
  serve();
  server.use(http.get(API, () => HttpResponse.json({ data: { ...organization.data, billable_rate: "500000" } })));
  await expect(client(ME).listProjectsWithRates()).rejects.toBeInstanceOf(SolidtimeApiError);
});
