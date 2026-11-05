import type { createApp } from "@fpm/app";
import type { Repository } from "@fpm/db";
import { Hono, type HonoRequest, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  parseClient,
  parseContract,
  parseHoursRangeOverride,
  parseMonth,
  parseProject,
} from "./validation.ts";

export interface ApiDeps {
  readonly repo: Repository;
  readonly app: ReturnType<typeof createApp>;
  readonly auth: MiddlewareHandler;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

async function readJson(request: HonoRequest): Promise<unknown> {
  try {
    return await request.json<unknown>();
  } catch (error) {
    if (error instanceof SyntaxError) throw new RangeError("Invalid JSON body");
    throw error;
  }
}

function assertId(urlId: string, bodyId: string): void {
  if (urlId !== bodyId) throw new RangeError("URL id must match body id");
}

function clientFilter(request: HonoRequest) {
  const clientId = request.query("clientId");
  return clientId === undefined ? {} : { clientId };
}

function syncStatus(result: { readonly ok: boolean; readonly error?: string }): 200 | 409 | 502 {
  return result.ok ? 200 : result.error === "busy" ? 409 : 502;
}

export function createApi({ repo, app, auth }: ApiDeps) {
  const api = new Hono();

  api.onError((error, c) => {
    if (error instanceof RangeError) return c.json({ error: error.message }, 400);
    return c.json({ error: "internal error" }, 500);
  });

  // Register health before auth so it can finish without invoking the middleware.
  api.get("/api/health", (c) => c.json({ ok: true }));
  api.use("/api/*", auth);

  api.get("/api/clients", async (c) => c.json(await repo.listClients()));
  api.get("/api/clients/:id", async (c) => {
    const client = await repo.getClient(c.req.param("id"));
    return client === null ? c.json({ error: "client not found" }, 404) : c.json(client);
  });
  api.put("/api/clients/:id", async (c) => {
    const client = parseClient(await readJson(c.req));
    assertId(c.req.param("id"), client.id);
    await repo.saveClient(client);
    return c.json({ ok: true });
  });

  api.get("/api/projects", async (c) => c.json(await repo.listProjects(clientFilter(c.req))));
  api.put("/api/projects/:id", async (c) => {
    const project = parseProject(await readJson(c.req));
    assertId(c.req.param("id"), project.id);
    await repo.saveProject(project);
    return c.json({ ok: true });
  });

  api.get("/api/contracts", async (c) => c.json(await repo.listContracts(clientFilter(c.req))));
  api.put("/api/contracts/:id", async (c) => {
    const contract = parseContract(await readJson(c.req));
    assertId(c.req.param("id"), contract.id);
    await repo.saveContract(contract);
    return c.json({ ok: true });
  });
  api.post("/api/contracts/:id/push-rates", async (c) => c.json(await app.pushRates(c.req.param("id"))));

  api.post("/api/hours-range-overrides", async (c) => {
    const override = parseHoursRangeOverride(await readJson(c.req));
    await repo.saveHoursRangeOverride(override);
    return c.json({ ok: true });
  });
  api.get("/api/hours-range-overrides", async (c) => {
    const month = c.req.query("month");
    return c.json(await repo.listHoursRangeOverrides(month === undefined ? {} : { month: parseMonth(month) }));
  });

  api.post("/api/sync/solidtime", async (c) => {
    const result = await app.syncSolidtime();
    return c.json(result, syncStatus(result));
  });
  api.post("/api/sync/calendar", async (c) => {
    const result = await app.syncCalendar();
    return c.json(result, syncStatus(result));
  });

  api.get("/api/dashboard", async (c) => c.json(await app.dashboard()));
  api.get("/api/invoice-guide", async (c) => {
    const clientId = c.req.query("clientId");
    if (!clientId) throw new RangeError("clientId is required");
    const month = parseMonth(c.req.query("month"));
    return c.json({ guide: await app.invoiceGuide({ clientId, month }) });
  });

  api.post("/api/projects/:id/documents", bodyLimit({
    // Allow multipart headers/fields while enforcing the file's exact limit below.
    maxSize: MAX_FILE_SIZE + 1024 * 1024,
    onError: (c) => c.json({ error: "file must be at most 20 MB" }, 413),
  }), async (c) => {
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "multipart/form-data") throw new RangeError("multipart file is required");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError) {
        throw new RangeError("Invalid multipart body");
      }
      throw error;
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new RangeError("file is required");
    if (file.size > MAX_FILE_SIZE) return c.json({ error: "file must be at most 20 MB" }, 413);
    return c.json(await app.uploadDocument({
      projectId: c.req.param("id"),
      name: file.name,
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    }));
  });

  return api;
}
