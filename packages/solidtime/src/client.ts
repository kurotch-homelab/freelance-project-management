import { assertResponse, SolidtimeApiError, SolidtimeAuthError } from "./errors.ts";
import { arrayData, dataOf, isNonnegativeInteger, isRecord, parseClient, parseProject, parseTimeEntry } from "./responses.ts";
import { createTimeZone } from "./time-zone.ts";
import type { ListTimeEntriesOptions, SolidtimeClient, SolidtimeClientOptions, TimeEntry } from "./types.ts";

export function createSolidtimeClient(options: SolidtimeClientOptions): SolidtimeClient {
  const { organizationId, token } = options;
  const apiUrl = `${options.baseUrl.replace(/\/+$/, "")}/api/v1`;
  const organizationPath = `/organizations/${encodeURIComponent(organizationId)}`;
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const zone = createTimeZone(options.timeZone);

  async function request<T>(
    path: string,
    parse: (body: unknown, status: number) => T,
  ): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetcher(`${apiUrl}${path}`, {
        method: "GET",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
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

  async function listTimeEntries({ from, to, pageSize = 500 }: ListTimeEntriesOptions): Promise<TimeEntry[]> {
    const { start, end } = zone.range(from, to);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new RangeError("pageSize must be an integer from 1 through 500");
    }
    const entries: TimeEntry[] = [];
    const seenIds = new Set<string>();
    let offset = 0;
    let total: number | undefined;
    do {
      const query = new URLSearchParams({ start, end, limit: String(pageSize), offset: String(offset) });
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
    listProjects: () => listResources("projects", parseProject),
    listClients: () => listResources("clients", parseClient),
    async listProjectsWithRates() {
      const [projects, organizationRate] = await Promise.all([
        listResources("projects", parseProject),
        request(organizationPath, (body, status) => parseRate(dataOf(body, status), status)),
      ]);
      return projects.map((project) => ({ ...project, hourlyRate: project.hourlyRate ?? organizationRate }));
    },
    async listTimeEntriesWithRates(range) {
      const entries = await listTimeEntries(range);
      if (entries.length === 0) return [];
      const [projects, members, organizationRate] = await Promise.all([
        listResources("projects", parseProject),
        listResources("members", (value, status) => {
          assertResponse(isRecord(value) && typeof value.id === "string" && typeof value.user_id === "string", status, "member fields");
          return { id: value.id, userId: value.user_id, rate: parseRate(value, status) };
        }),
        request(organizationPath, (body, status) => parseRate(dataOf(body, status), status)),
      ]);
      const projectsById = new Map(projects.map((project) => [project.id, project]));
      const membersByUser = new Map(members.map((member) => [member.userId, member]));
      const projectRates = new Map<string, Map<string, number | null>>();
      // Only projects with completed entries need their member rates, including every page.
      for (const projectId of new Set(entries.flatMap((entry) => entry.projectId === null ? [] : [entry.projectId]))) {
        const projectMembers = await listResources(`projects/${encodeURIComponent(projectId)}/project-members`, (value, status) => {
          assertResponse(isRecord(value) && typeof value.member_id === "string", status, "project member fields");
          return { memberId: value.member_id, rate: parseRate(value, status) };
        });
        projectRates.set(projectId, new Map(projectMembers.map((member) => [member.memberId, member.rate])));
      }
      return entries.map((entry) => {
        const member = membersByUser.get(entry.userId);
        // Former members' entries fall back to project and organization rates.
        const projectMemberRate = entry.projectId !== null && member
          ? projectRates.get(entry.projectId)?.get(member.id)
          : null;
        const projectRate = entry.projectId === null ? null : projectsById.get(entry.projectId)?.hourlyRate;
        return { ...entry, hourlyRate: projectMemberRate ?? projectRate ?? member?.rate ?? organizationRate };
      });
    },
  };
}

function parseRate(value: unknown, status: number): number | null {
  assertResponse(isRecord(value) && (value.billable_rate === null || isNonnegativeInteger(value.billable_rate)), status, "billable_rate");
  return value.billable_rate === null ? null : value.billable_rate / 100;
}
