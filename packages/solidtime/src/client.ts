import { assertResponse, SolidtimeApiError, SolidtimeAuthError } from "./errors.ts";
import { arrayData, dataOf, isNonnegativeInteger, isRecord, parseClient, parseProject, parseTimeEntry } from "./responses.ts";
import { createTimeZone } from "./time-zone.ts";
import type { ListTimeEntriesOptions, ProjectDailyWork, SolidtimeClient, SolidtimeClientOptions, TimeEntry } from "./types.ts";

function rateInHundredths(yen: number): number {
  if (!Number.isSafeInteger(yen) || yen < 0 || !Number.isSafeInteger(yen * 100)) {
    throw new RangeError("hourlyRate must be non-negative whole yen representable in hundredths");
  }
  return yen * 100;
}

export function createSolidtimeClient(options: SolidtimeClientOptions): SolidtimeClient {
  const { organizationId, token } = options;
  const apiUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
  const organizationPath = `/organizations/${encodeURIComponent(organizationId)}`;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const zone = createTimeZone(options.timeZone);
  let memberId = options.memberId;

  async function request<T>(
    path: string,
    parse: (body: unknown, status: number) => T,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetcher(`${apiUrl}${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // The fetch signal also limits reading the body after headers have arrived.
      text = await response.text();
    } catch {
      // A transport exception can contain headers or the URL; do not retain it as cause.
      throw new SolidtimeApiError(null);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON errors must still be classified by HTTP status (especially 401).
    }
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : undefined;
      let detail = message?.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
      if (token && detail !== undefined) {
        detail = detail.replaceAll(encodeURIComponent(token), "[REDACTED]").replaceAll(token, "[REDACTED]");
      }
      if (response.status === 401) throw new SolidtimeAuthError(detail);
      throw new SolidtimeApiError(response.status, detail);
    }
    return parse(payload, response.status);
  }

  async function resolveMemberId(): Promise<string> {
    if (memberId !== undefined) return memberId;
    memberId = await request("/users/me/memberships", (body, status) => {
      const memberships = arrayData(body, status).map((membership) => {
        assertResponse(
          isRecord(membership) && typeof membership.id === "string" &&
          isRecord(membership.organization) && typeof membership.organization.id === "string",
          status, "membership fields",
        );
        return { id: membership.id, organizationId: membership.organization.id };
      });
      const membership = memberships.find((item) => item.organizationId === organizationId);
      if (!membership) throw new SolidtimeApiError(status, "No membership found for the configured organization");
      return membership.id;
    });
    return memberId;
  }

  async function listTimeEntries({ from, to, pageSize = 500 }: ListTimeEntriesOptions): Promise<TimeEntry[]> {
    const { start, end } = zone.range(from, to);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new RangeError("pageSize must be an integer from 1 through 500");
    }
    const member = await resolveMemberId();
    const entries: TimeEntry[] = [];
    const seenIds = new Set<string>();
    let offset = 0;
    let total: number | undefined;
    do {
      const query = new URLSearchParams({ start, end, member_id: member, limit: String(pageSize), offset: String(offset) });
      const page = await request(`${organizationPath}/time-entries?${query}`, (body, status) => {
        const data = arrayData(body, status);
        assertResponse(isRecord(body) && isRecord(body.meta) && isNonnegativeInteger(body.meta.total), status, "meta.total");
        assertResponse(total === undefined || body.meta.total === total, status, "meta.total changed between pages");
        assertResponse(data.length > 0 || offset >= body.meta.total, status, "empty page before meta.total");
        // Check raw rows so running entries participate in duplicate detection too.
        for (const entry of data) {
          assertResponse(isRecord(entry) && typeof entry.id === "string", status, "time entry id");
          assertResponse(!seenIds.has(entry.id), status, "duplicate time entry id");
          seenIds.add(entry.id);
        }
        return { entries: data.map((entry) => parseTimeEntry(entry, status, zone.date)), count: data.length, total: body.meta.total };
      });
      for (const entry of page.entries) if (entry !== null) entries.push(entry);
      // Advance by raw rows, including running entries removed from the result.
      offset += page.count;
      total ??= page.total;
    } while (offset < total);
    return entries;
  }

  async function listResources<T>(path: string, parse: (value: unknown, status: number) => T): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const current = await request(`${organizationPath}/${path}?page=${page}`, (body, status) => {
        const data = arrayData(body, status).map((value) => parse(value, status));
        assertResponse(isRecord(body) && isRecord(body.meta), status, "meta");
        assertResponse(
          isNonnegativeInteger(body.meta.current_page) && body.meta.current_page === page,
          status, "meta.current_page",
        );
        assertResponse(
          isNonnegativeInteger(body.meta.last_page) && body.meta.last_page >= page,
          status, "meta.last_page",
        );
        const last = body.meta.last_page;
        assertResponse(data.length > 0 || page === last, status, "empty resource page");
        return { data, last };
      });
      results.push(...current.data);
      lastPage = current.last;
      page++;
    } while (page <= lastPage);
    return results;
  }

  return {
    listTimeEntries,
    async dailyWork(range) {
      const projects = new Map<string, Map<string, number>>();
      for (const entry of await listTimeEntries(range)) {
        if (!entry.billable || entry.projectId === null) continue;
        const days = projects.get(entry.projectId) ?? new Map<string, number>();
        const seconds = (days.get(entry.date) ?? 0) + entry.seconds;
        if (!Number.isSafeInteger(seconds)) throw new SolidtimeApiError(200, "Daily work total exceeds safe integer precision");
        days.set(entry.date, seconds);
        projects.set(entry.projectId, days);
      }
      const work: ProjectDailyWork[] = [];
      for (const projectId of [...projects.keys()].sort()) {
        const days = projects.get(projectId)!;
        for (const date of [...days.keys()].sort()) work.push({ projectId, date, seconds: days.get(date)! });
      }
      return work;
    },
    listProjects: () => listResources("projects", parseProject),
    listClients: () => listResources("clients", parseClient),
    createClient: (name) => request(
      `${organizationPath}/clients`, (body, status) => parseClient(dataOf(body, status), status), "POST", { name },
    ),
    async createProject(input) {
      const rate = input.hourlyRate == null ? null : rateInHundredths(input.hourlyRate);
      return request(`${organizationPath}/projects`, (body, status) => parseProject(dataOf(body, status), status), "POST", {
        name: input.name,
        // The API requires a color even when the caller does not choose one.
        color: input.color ?? "#ef5350",
        client_id: input.clientId ?? null,
        is_billable: input.isBillable ?? true,
        billable_rate: rate,
        is_public: input.isPublic ?? false,
        estimated_time: input.estimatedTime ?? null,
      });
    },
    async setProjectRate(projectId, hourlyRate) {
      const rate = rateInHundredths(hourlyRate);
      const path = `${organizationPath}/projects/${encodeURIComponent(projectId)}`;
      const current = await request(path, (body, status) => parseProject(dataOf(body, status), status));
      return request(path, (body, status) => parseProject(dataOf(body, status), status), "PUT", {
        name: current.name,
        color: current.color,
        client_id: current.clientId,
        is_billable: current.isBillable,
        billable_rate: rate,
      });
    },
  };
}
