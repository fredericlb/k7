// projects.ts — the REGISTER of git repositories a person has added: which ones exist, what
// URI is behind a short name, and which one holds the libraries. Not what is INSIDE them —
// that is the engine machine's answer, out of the working copies it holds (see
// apps/st0/frontend/docs/projects.md). This service also owns the one deploy key, which is why
// the last route here hands a private key to that machine.
// See ../../docs/projects.md and packages/git-repos/docs/keys.md.

import { wrap } from "@frediverse/http/route";
import { generateKey, privateKey, publicKey } from "@studio/git-repos/keys";
import { assertSshGitUri } from "@studio/git-repos/uri";
import type { Request } from "express";
import express, { Router } from "express";
import { rememberIdentity, subFor } from "../projects/identities.ts";
import {
  addRepo,
  clearLibrariesRepo,
  findRepo,
  findReposByName,
  keyDirFor,
  librariesRepo,
  listRepos,
  nameOf,
  removeRepo,
  revision,
  setLibrariesRepo,
} from "../projects/store.ts";

/** pl8 has no express type augmentation of its own; every route here reads the user this way. */
function subOf(req: Request): string | null {
  const u = (req as { user?: { sub?: string; email?: string } }).user;
  return u?.sub ?? u?.email ?? null;
}

/** The email beside it, when the IdP sent one — what the file service knows a person by. */
function emailOf(req: Request): string | null {
  return (req as { user?: { email?: string } }).user?.email ?? null;
}

/** `scripts/tokens.mjs`'s prefix, as a literal: plain node cannot import this, so a test agrees it. */
const SERVICE_SUB_PREFIX = "service:";

export function projectsRouter(opts: {
  /** Used by the private-key route alone, to insist on a bearer where a cookie would do. */
  verifyApiToken: (token: string) => string | null;
}): Router {
  const router: Router = Router();

  router.use((req, res, next) => {
    const sub = subOf(req);
    if (!sub) return res.status(401).json({ error: "no user on the session" });
    // The one place both spellings of a person are in hand at once — this service mints no session.
    rememberIdentity(sub, emailOf(req));
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

  /** The PRIVATE half, bearer ONLY and never a session — see ../../docs/sshKeyForService.md. */
  router.get(
    "/ssh-key/private",
    wrap((req, res) => {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
      const bearer = m ? opts.verifyApiToken(m[1].trim()) : null;
      if (!bearer)
        return res
          .status(401)
          .json({ error: "this route takes an API token, not a session" });
      const asked = typeof req.query.user === "string" ? req.query.user : "";
      const service = bearer.startsWith(SERVICE_SUB_PREFIX);
      if (service && !asked)
        return res.status(400).json({
          error: "a service token must say whose key it is asking for (?user=)",
        });
      // Refused rather than ignored: handing back your own key here would read as success.
      if (!service && asked && subFor(asked) !== bearer)
        return res
          .status(403)
          .json({ error: "an account token can only ask for its own key" });
      // `subFor` because the two halves spell a person differently: an email against a subject.
      const owner = service ? subFor(asked) : bearer;
      const dir = keyDirFor(owner);
      const key = privateKey(dir);
      if (!key)
        return res.status(404).json({
          error:
            "no SSH key yet — open st0's home page to generate one, then add it to your git host",
        });
      res.set("Cache-Control", "no-store");
      res.json({ privateKey: key, publicKey: publicKey(dir) });
    }),
  );

  /** Every repository REGISTERED, and nothing about what is in one — ../../docs/projects.md. */
  router.get(
    "/",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const repos = listRepos(sub).map((r) => ({ ...r, name: nameOf(r) }));
      res.json({ repos, revision: revision(sub) });
    }),
  );

  /** The URI behind a short name — an address bar must never carry one; ../../docs/projects.md. */
  router.get(
    "/by-name/:name",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const matches = findReposByName(sub, req.params.name);
      if (!matches.length)
        return res.status(404).json({
          error: `no repository called '${req.params.name}' — add it on st0's home page, or open the project from there`,
        });
      // Ambiguous is not "pick one": see findReposByName.
      if (matches.length > 1)
        return res.status(409).json({
          error: `'${req.params.name}' names ${matches.length} repositories here (${matches
            .map((r) => r.uri)
            .join(", ")}) — open the project from st0's home page`,
        });
      const repo = matches[0];
      res.json({ id: repo.id, name: nameOf(repo), uri: repo.uri });
    }),
  );

  /** The LIBRARY repository. `null` and not a 404 for "none set" — it is a state callers ACT on. */
  router.get(
    "/libraries",
    wrap((req, res) => {
      const repo = librariesRepo(subOf(req)!);
      res.json({
        libraries: repo
          ? { id: repo.id, name: nameOf(repo), uri: repo.uri }
          : null,
      });
    }),
  );

  /** Point them at a repository. PUT and not POST: there is one, so this SETS rather than adds. */
  router.put(
    "/libraries",
    express.json(),
    wrap(async (req, res) => {
      const sub = subOf(req)!;
      const uri = String(req.body?.uri ?? "").trim();
      try {
        assertSshGitUri(uri);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
      // Same key as every other repository, and there has to be one before anything can clone.
      await generateKey(keyDirFor(sub), `studio-${sub}`);
      const repo = setLibrariesRepo(sub, uri);
      // Recorded, not verified: the first clone is what says whether git answers for this URI.
      res.json({ libraries: { ...repo, name: nameOf(repo) } });
    }),
  );

  router.delete(
    "/libraries",
    wrap((req, res) => {
      const sub = subOf(req)!;
      if (!clearLibrariesRepo(sub))
        return res.status(404).json({ error: "no libraries repository set" });
      res.json({ ok: true });
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
      // The clone st0 starts right after cannot run without a key, and this is the first need.
      await generateKey(keys, `studio-${sub}`);
      const { repo, added } = addRepo(sub, uri, req.body?.label);
      res
        .status(added ? 201 : 200)
        .json({ repo: { ...repo, name: nameOf(repo) } });
    }),
  );

  router.delete(
    "/:id",
    wrap((req, res) => {
      const sub = subOf(req)!;
      if (!removeRepo(sub, req.params.id))
        return res.status(404).json({ error: "unknown repository" });
      // Nothing else to drop: removing a name from a list must not delete somebody's files.
      res.json({ ok: true });
    }),
  );

  // `/:id/status`, `/:id/refresh` and `/:id/tree` were here; all three were about the gone mirror.

  return router;
}
