// projects.ts — the git repositories a person has added, and what is inside them. st0 keeps
// a bare blobless mirror of each and NEVER a working copy: the checkout belongs on the
// machine the engine runs on, which is the file service's job. This service also owns the
// one deploy key, which is why the last route here hands a private key to that machine.
// See ../../docs/projects.md, packages/git-repos/docs/{mirror,keys}.md.

import { wrap } from "@frediverse/http/route";
import { generateKey, privateKey, publicKey } from "@studio/git-repos/keys";
import type { RepoProject } from "@studio/git-repos/mirror";
import { assertSshGitUri } from "@studio/git-repos/uri";
import type { Request } from "express";
import express, { Router } from "express";
import {
  ensure,
  forget,
  MirrorNotReadyError,
  read,
  status,
  sweep,
} from "../projects/mirrors.ts";
import {
  addRepo,
  findRepo,
  keyDirFor,
  listRepos,
  removeRepo,
  revision,
} from "../projects/store.ts";

/** st0 has no express type augmentation of its own; every route here reads the user this way. */
function subOf(req: Request): string | null {
  const u = (req as { user?: { sub?: string; email?: string } }).user;
  return u?.sub ?? u?.email ?? null;
}

export function projectsRouter(opts: {
  /** Used by the private-key route alone, to insist on a bearer where a cookie would do. */
  verifyApiToken: (token: string) => string | null;
}): Router {
  const router: Router = Router();

  router.use((req, res, next) => {
    if (!subOf(req))
      return res.status(401).json({ error: "no user on the session" });
    next();
  });

  /** This user's change token, for the médiathèque's single poll. */
  router.get(
    "/revision",
    wrap((req, res) => {
      res.json({ revision: revision(subOf(req)!) });
    }),
  );

  /** The PUBLIC half — what you paste into your git host. */
  router.get(
    "/ssh-key",
    wrap((req, res) => {
      res.json({ publicKey: publicKey(keyDirFor(subOf(req)!)) });
    }),
  );

  /** Generate it if absent. Idempotent, so a second click is not a second key. */
  router.post(
    "/ssh-key",
    wrap(async (req, res) => {
      const sub = subOf(req)!;
      res.json({
        publicKey: await generateKey(keyDirFor(sub), `studio-${sub}`),
      });
    }),
  );

  /**
   * The PRIVATE half, for the file service on this user's engine machine.
   *
   * Bearer only — deliberately not `bearerOrSession`. A session cookie is sent by a browser
   * on any navigation, so accepting one here would make this reachable by pointing a logged-in
   * tab at the URL. A bearer is only ever attached on purpose, and the token's subject IS the
   * owner, so there is no cross-user request to reject. See packages/git-repos/docs/keys.md.
   */
  router.get(
    "/ssh-key/private",
    wrap((req, res) => {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
      const owner = m ? opts.verifyApiToken(m[1].trim()) : null;
      if (!owner)
        return res
          .status(401)
          .json({ error: "this route takes an API token, not a session" });
      const dir = keyDirFor(owner);
      const key = privateKey(dir);
      if (!key)
        return res.status(404).json({
          error:
            "no SSH key yet — open Projets in the médiathèque to generate one, then add it to your git host",
        });
      res.set("Cache-Control", "no-store");
      res.json({ privateKey: key, publicKey: publicKey(dir) });
    }),
  );

  /** Every repository, with what its mirror can already say about it. */
  router.get(
    "/",
    wrap(async (req, res) => {
      const sub = subOf(req)!;
      const repos = await Promise.all(
        listRepos(sub).map(async (r) => {
          const st = status(sub, r.id);
          // A mirror that is not ready yet reports null rather than 0 — "unknown" and "none" differ.
          let projects: RepoProject[] | null = null;
          let branch: string | null = null;
          if (st.ready)
            try {
              const listing = await read(sub, r.id);
              projects = listing.projects;
              branch = listing.branch;
            } catch {
              /* raced with an eviction — the status is the honest answer */
            }
          // The projects themselves, not just how many: the listing draws them under their
          // repository and links straight into l8/m9, so opening one costs no second request.
          return { ...r, ...st, branch, projects };
        }),
      );
      res.json({ repos, revision: revision(sub) });
    }),
  );

  /** Add one. Adding the same repository twice is not an error — you get the one that is there. */
  router.post(
    "/",
    express.json(),
    wrap(async (req, res) => {
      const sub = subOf(req)!;
      const uri = String(req.body?.uri ?? "").trim();
      try {
        assertSshGitUri(uri);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
      const keys = keyDirFor(sub);
      // The mirror below cannot run without a key, and this is the first moment one is needed.
      await generateKey(keys, `studio-${sub}`);
      const { repo, added } = addRepo(sub, uri, req.body?.label);
      res
        .status(added ? 201 : 200)
        .json({ repo, ...ensure(sub, repo.id, repo.uri) });
    }),
  );

  router.delete(
    "/:id",
    wrap((req, res) => {
      const sub = subOf(req)!;
      if (!removeRepo(sub, req.params.id))
        return res.status(404).json({ error: "unknown repository" });
      forget(sub, req.params.id);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/:id/status",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const repo = findRepo(sub, req.params.id);
      if (!repo) return res.status(404).json({ error: "unknown repository" });
      res.json(status(sub, repo.id));
    }),
  );

  /** Fetch again now. Returns the status, not the result — the fetch outlives this request. */
  router.post(
    "/:id/refresh",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const repo = findRepo(sub, req.params.id);
      if (!repo) return res.status(404).json({ error: "unknown repository" });
      res.json(ensure(sub, repo.id, repo.uri, true));
    }),
  );

  /**
   * The tree, with `project: true` on every folder holding a `project.yaml` — the same
   * `FileNode` the file service serves, so both trees draw the same rows.
   *
   * 202 while the first fetch is still running: the repository is known, its contents are
   * not yet, and that is neither an error nor an empty repository.
   */
  router.get(
    "/:id/tree",
    wrap(async (req, res) => {
      const sub = subOf(req)!;
      const repo = findRepo(sub, req.params.id);
      if (!repo) return res.status(404).json({ error: "unknown repository" });
      ensure(sub, repo.id, repo.uri);
      try {
        res.json({ repo, ...(await read(sub, repo.id)) });
      } catch (e) {
        if (e instanceof MirrorNotReadyError)
          return res.status(202).json({ repo, ...status(sub, repo.id) });
        throw e;
      }
    }),
  );

  // Idle mirrors are swept once at boot and daily after — a fortnight's grace, and the next
  // look recreates what it drops.
  sweep();
  setInterval(sweep, 24 * 60 * 60 * 1000).unref();

  return router;
}
