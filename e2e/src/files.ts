// files.ts — the e2e account's file service, reached the way the browser reaches it: through /api/files with a hub ticket.
// Writes go over HTTP, never to disk: the live-sync relay restores a folder deleted behind its back (docs/e2e.md).
import type { APIRequestContext } from "@playwright/test";

const TICKET_HEADER = "x-studio-engine-token";
const WORKSPACE_HEADER = "x-studio-workspace";

export class FileService {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly base: string,
    private readonly ticket: string,
  ) {}

  /** Asks k7's backend for a ticket; `request` must carry the e2e session cookie. */
  static async connect(request: APIRequestContext): Promise<FileService> {
    const res = await request.get("/api/files-hub");
    if (!res.ok())
      throw new Error(`files-hub: ${res.status()} ${await res.text()}`);
    const { path, ticket } = (await res.json()) as {
      path: string;
      ticket: string;
    };
    return new FileService(request, path, ticket);
  }

  private headers(workspace?: string): Record<string, string> {
    const h: Record<string, string> = { [TICKET_HEADER]: this.ticket };
    if (workspace) h[WORKSPACE_HEADER] = workspace;
    return h;
  }

  private async call<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    opts: { workspace?: string; data?: unknown; ok?: number[] } = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.request.fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(opts.workspace),
      data: opts.data,
    });
    const text = await res.text();
    const body = (text ? JSON.parse(text) : undefined) as T;
    if (!res.ok() && !opts.ok?.includes(res.status()))
      throw new Error(`${method} ${path}: ${res.status()} ${text}`);
    return { status: res.status(), body };
  }

  /** Removes the workspace and its relay room; a missing one is not an error. */
  async removeWorkspace(name: string) {
    await this.call("POST", "/workspaces/remove", {
      data: { name },
      ok: [400],
    });
  }

  async createWorkspace(name: string) {
    await this.call("POST", "/workspaces", { data: { name } });
  }

  /** Scaffolds a project by archetype, as the "New project" dialog does. */
  async createProject(workspace: string, shape: string, name: string) {
    return (
      await this.call<{ project: string }>("POST", "/project/create", {
        workspace,
        data: { shape, name },
      })
    ).body;
  }

  async writeText(workspace: string, path: string, content: string) {
    await this.call("PUT", "/file", { workspace, data: { path, content } });
  }

  /** Uploads bytes; the service refuses to overwrite, so a fresh workspace is assumed. */
  async upload(workspace: string, path: string, bytes: Buffer) {
    const slash = path.lastIndexOf("/");
    const query = new URLSearchParams({
      dir: slash < 0 ? "" : path.slice(0, slash),
      name: path.slice(slash + 1),
    });
    const res = await this.request.fetch(`${this.base}/upload?${query}`, {
      method: "POST",
      headers: {
        ...this.headers(workspace),
        "content-type": "application/octet-stream",
      },
      data: bytes,
    });
    if (!res.ok())
      throw new Error(`upload ${path}: ${res.status()} ${await res.text()}`);
  }

  /** Waits until the relay holds the project, which `/open` refuses before. */
  async waitSynced(workspace: string, project: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { body } = await this.call<{ ready?: boolean }>(
        "GET",
        `/sync/project?path=${encodeURIComponent(project)}`,
        { workspace },
      );
      if (body?.ready !== false) return;
      if (Date.now() > deadline) throw new Error(`${project} never synced`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** Makes `project` the workspace's active one, retrying while it is still syncing. */
  async open(workspace: string, project: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { status } = await this.call("POST", "/open", {
        workspace,
        data: { path: project },
        ok: [409],
      });
      if (status !== 409) return;
      if (Date.now() > deadline)
        throw new Error(`${project} still syncing after ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** The active project's compile errors; empty when it loads. */
  async projectErrors(workspace: string): Promise<unknown> {
    return (await this.call("GET", "/project-errors", { workspace })).body;
  }

  /** The active project compiled for the engine; throws with the compiler's message when it does not compile. */
  async engineDoc(workspace: string): Promise<unknown> {
    return (await this.call("GET", "/engine-doc", { workspace })).body;
  }
}
