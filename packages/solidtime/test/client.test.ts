import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSolidtimeClient, SolidtimeApiError, SolidtimeAuthError } from "../src/index.ts";
import memberships from "./fixtures/memberships.json" with { type: "json" };
import page1 from "./fixtures/time-entries-page1.json" with { type: "json" };
import page2 from "./fixtures/time-entries-page2.json" with { type: "json" };
import projectsList from "./fixtures/projects-list.json" with { type: "json" };
import clientsList from "./fixtures/clients-list.json" with { type: "json" };
import error401 from "./fixtures/error-401.json" with { type: "json" };

// フィクスチャは 2026-11-05 に Sandbox 組織で記録した実際のレスポンス
const BASE = "https://solidtime.test";
const ORG = "3f0aff22-3659-4916-9828-38f3aa7f4c23";
const API = `${BASE}/api/v1/organizations/${ORG}`;
const MEMBER = memberships.data[0]!.id;
const PROJECT = page1.data[0]!.project_id;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const client = () =>
  createSolidtimeClient({ baseUrl: BASE, organizationId: ORG, token: "test-token", timeZone: "Asia/Tokyo" });

/** 届いたリクエストを記録する */
const recorded: Request[] = [];
afterEach(() => {
  recorded.length = 0;
});

const membershipsHandler = http.get(`${BASE}/api/v1/users/me/memberships`, ({ request }) => {
  recorded.push(request.clone());
  return HttpResponse.json(memberships);
});

/** limit / offset に応じて page1 / page2 を返す(フィクスチャは limit=2 で記録) */
const timeEntriesHandler = http.get(`${API}/time-entries`, ({ request }) => {
  recorded.push(request.clone());
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  return HttpResponse.json(offset === 0 ? page1 : page2);
});

describe("listTimeEntries: 期間の打刻を取得する", () => {
  it("日本時間の日付の範囲を、UTC の start / end に直して送る", async () => {
    server.use(membershipsHandler, timeEntriesHandler);
    await client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    const url = new URL(recorded.find((r) => r.url.includes("/time-entries"))!.url);
    expect(url.searchParams.get("start")).toBe("2026-10-31T15:00:00Z");
    expect(url.searchParams.get("end")).toBe("2026-11-30T15:00:00Z");
    expect(url.searchParams.get("member_id")).toBe(MEMBER);
  });

  it("Authorization と Accept ヘッダを付ける", async () => {
    server.use(membershipsHandler, timeEntriesHandler);
    await client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    for (const r of recorded) {
      expect(r.headers.get("authorization")).toBe("Bearer test-token");
      expect(r.headers.get("accept")).toBe("application/json");
    }
  });

  it("ページを送って全件取る(total 4 件、2 件ずつ)", async () => {
    server.use(membershipsHandler, timeEntriesHandler);
    const entries = await client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    expect(entries).toHaveLength(4);
    const offsets = recorded
      .filter((r) => r.url.includes("/time-entries"))
      .map((r) => new URL(r.url).searchParams.get("offset"));
    expect(offsets).toEqual(["0", "2"]);
  });

  it("打刻を日本時間の開始日・秒数・請求対象かどうかに直す", async () => {
    server.use(membershipsHandler, timeEntriesHandler);
    const entries = await client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    const byDescription = (d: string) => entries.find((e) => e.description === d);
    // 11/02 23:00〜11/03 01:00(日本時間)は開始日の 11/02
    expect(byDescription("23:00-01:00 JST across midnight")).toMatchObject({
      projectId: PROJECT,
      date: "2026-11-02",
      seconds: 7_200,
      billable: true,
    });
    // 11/30 23:30〜12/01 00:30(日本時間)は 11/30
    expect(byDescription("23:30-00:30 JST across month end")).toMatchObject({ date: "2026-11-30", seconds: 3_600 });
    // UTC では 11/03 01:00 = 日本時間 11/03 10:00
    expect(byDescription("non-billable 30m")).toMatchObject({ date: "2026-11-03", seconds: 1_800, billable: false });
  });

  it("memberId を指定したらメンバーシップを取りに行かない", async () => {
    server.use(timeEntriesHandler);
    const c = createSolidtimeClient({
      baseUrl: BASE,
      organizationId: ORG,
      token: "test-token",
      timeZone: "Asia/Tokyo",
      memberId: MEMBER,
    });
    await expect(c.listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 })).resolves.toHaveLength(4);
  });

  it("実行中の打刻(end が null)は除く", async () => {
    const running = { ...page1.data[0]!, id: "running", end: null, duration: null };
    server.use(
      membershipsHandler,
      http.get(`${API}/time-entries`, () => HttpResponse.json({ data: [running], meta: { total: 1 } })),
    );
    await expect(client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([]);
  });

  it("from が to より後なら受け付けない", async () => {
    await expect(client().listTimeEntries({ from: "2026-12-01", to: "2026-11-30" })).rejects.toThrow(RangeError);
  });
});

describe("ページを送っている途中の変化", () => {
  it("途中で total が変わったら失敗する(部分的な結果を返さない)", async () => {
    server.use(
      membershipsHandler,
      http.get(`${API}/time-entries`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        return HttpResponse.json(offset === 0 ? page1 : { ...page2, meta: { total: 5 } });
      }),
    );
    await expect(client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 })).rejects.toBeInstanceOf(
      SolidtimeApiError,
    );
  });

  it("ページをまたいで同じ打刻が返ってきたら失敗する(二重に数えない)", async () => {
    server.use(
      membershipsHandler,
      http.get(`${API}/time-entries`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        return HttpResponse.json(offset === 0 ? page1 : { ...page2, data: [page1.data[1], page2.data[1]] });
      }),
    );
    await expect(client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 })).rejects.toBeInstanceOf(
      SolidtimeApiError,
    );
  });

  it("実行中の打刻を除いても、offset は生のデータの件数で進める", async () => {
    const running = { ...page1.data[0]!, id: "running", end: null, duration: null };
    server.use(
      membershipsHandler,
      http.get(`${API}/time-entries`, ({ request }) => {
        recorded.push(request.clone());
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        return HttpResponse.json(
          offset === 0
            ? { data: [running, page1.data[0]], meta: { total: 3 } }
            : { data: [page1.data[1]], meta: { total: 3 } },
        );
      }),
    );
    const entries = await client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    expect(entries).toHaveLength(2);
    expect(
      recorded.filter((r) => r.url.includes("/time-entries")).map((r) => new URL(r.url).searchParams.get("offset")),
    ).toEqual(["0", "2"]);
  });
});

describe("dailyWork: 請求対象の打刻を、案件 × 日ごとの秒数にまとめる", () => {
  it("請求対象外は除き、同じ案件・同じ日は合計する", async () => {
    server.use(membershipsHandler, timeEntriesHandler);
    const work = await client().dailyWork({ from: "2026-11-01", to: "2026-11-30", pageSize: 2 });
    expect(work).toEqual([
      { projectId: PROJECT, date: "2026-11-02", seconds: 12_600 + 7_200 },
      { projectId: PROJECT, date: "2026-11-30", seconds: 3_600 },
    ]);
  });

  it("案件のない打刻は除く", async () => {
    const noProject = { ...page1.data[0]!, id: "np", project_id: null };
    server.use(
      membershipsHandler,
      http.get(`${API}/time-entries`, () => HttpResponse.json({ data: [noProject], meta: { total: 1 } })),
    );
    await expect(client().dailyWork({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([]);
  });
});

describe("取引先・プロジェクト", () => {
  it("listProjects: 単価は円に直す(solidtime は 1/100 単位)", async () => {
    server.use(http.get(`${API}/projects`, () => HttpResponse.json(projectsList)));
    const [p] = await client().listProjects();
    // 一覧は単価を 6,000 円に変えたあとに記録した
    expect(p).toMatchObject({ name: "fixture project", hourlyRate: 6_000, isBillable: true });
    expect(p?.clientId).toBe(projectsList.data[0]!.client_id);
  });

  it("listClients", async () => {
    server.use(http.get(`${API}/clients`, () => HttpResponse.json(clientsList)));
    await expect(client().listClients()).resolves.toEqual([
      { id: clientsList.data[0]!.id, name: "fixture client", isArchived: false },
    ]);
  });

});

describe("エラー", () => {
  it("401 は SolidtimeAuthError(トークンの期限切れや誤り)", async () => {
    server.use(http.get(`${API}/projects`, () => HttpResponse.json(error401, { status: 401 })));
    await expect(client().listProjects()).rejects.toBeInstanceOf(SolidtimeAuthError);
  });

  it("そのほかの失敗は SolidtimeApiError(status とメッセージを持つ)", async () => {
    server.use(
      http.get(`${API}/projects`, () => HttpResponse.json({ message: "Server Error" }, { status: 500 })),
    );
    const error = await client()
      .listProjects()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SolidtimeApiError);
    // message は状態コードから作る固定の文。サーバーのメッセージは detail に入れる
    expect(error).toMatchObject({ status: 500, message: "Solidtime request failed (HTTP 500)", detail: "Server Error" });
  });

  it("エラーメッセージにトークンを含めない", async () => {
    server.use(http.get(`${API}/projects`, () => HttpResponse.json({ message: "nope" }, { status: 500 })));
    const error = await client()
      .listProjects()
      .catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("test-token");
    expect(JSON.stringify(error)).not.toContain("test-token");
  });

  it("サーバーのメッセージに入ったトークンは、そのままの形でも URL エンコードされた形でも伏せる", async () => {
    const token = "123|secret";
    const c = createSolidtimeClient({ baseUrl: BASE, organizationId: ORG, token, timeZone: "Asia/Tokyo" });
    server.use(
      http.get(`${API}/projects`, () =>
        HttpResponse.json(
          { message: `bad: ${token} / Authorization: Bearer ${encodeURIComponent(token)}` },
          { status: 500 },
        ),
      ),
    );
    const error = await c.listProjects().catch((e: unknown) => e);
    const serialized = JSON.stringify(error) + String((error as Error).message) + String((error as Error).stack);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain(encodeURIComponent(token));
  });

  it("時間の上限を過ぎたら SolidtimeApiError(status なし)", async () => {
    const c = createSolidtimeClient({
      baseUrl: BASE,
      organizationId: ORG,
      token: "test-token",
      timeZone: "Asia/Tokyo",
      timeoutMs: 50,
    });
    server.use(
      http.get(`${API}/projects`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return HttpResponse.json(projectsList);
      }),
    );
    const error = await c.listProjects().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SolidtimeApiError);
    expect(error).toMatchObject({ status: null });
  });

  it("一覧のページ情報(meta)がなければ失敗する", async () => {
    server.use(http.get(`${API}/projects`, () => HttpResponse.json({ data: [] })));
    await expect(client().listProjects()).rejects.toBeInstanceOf(SolidtimeApiError);
  });

  it("組織のメンバーシップが見つからなければ失敗する", async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me/memberships`, () => HttpResponse.json({ data: [] })),
    );
    await expect(client().listTimeEntries({ from: "2026-11-01", to: "2026-11-30" })).rejects.toThrow(
      SolidtimeApiError,
    );
  });
});
