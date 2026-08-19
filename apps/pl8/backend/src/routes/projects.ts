// projects.ts — the git repositories a person has added, and what is inside them. pl8 keeps
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
import { rememberIdentity, subFor } from "../projects/identities.ts";
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

/** What `scripts/tokens.mjs` prefixes a machine-to-service token's subject with. A literal and
 *  not an import: that script is plain node and cannot read TypeScript, so the two agree by
 *  this comment and by the test below it. */
const SERVICE_SUB_PREFIX = "service:";

export function projectsRouter(opts: {
  /** Used by the private-key route alone, to insist on a bearer where a cookie would do. */
  verifyApiToken: (token: string) => string | null;
}): Router {
  const router: Router = Router();

  router.use((req, res, next) => {
    const sub = subOf(req);
    if (!sub) return res.status(401).json({ error: "no user on the session" });
    // The one place both spellings of a person are in hand at once. Recorded here rather than
    // at login because this service mints no session — it verifies one pl8 already issued.
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

  /**
   * The PRIVATE half, for the file service on this user's engine machine.
   *
   * Bearer only — deliberately not `bearerOrSession`. A session cookie is sent by a browser
   * on any navigation, so accepting one here would make this reachable by pointing a logged-in
   * tab at the URL. A bearer is only ever attached on purpose.
   *
   * WHOSE key, then. An ACCOUNT token answers that by itself: its subject is the owner and no
   * `user` is accepted, so a person's own token can never reach for somebody else's. A SERVICE
   * token — which is what a machine actually holds (`scripts/tokens.mjs`) — has no key of its
   * own, so it must NAME the person, and any name it gives is honoured. That is the accepted
   * cost of one credential per machine rather than one per person: whoever holds a machine's
   * token can ask for anyone's key. See ../../docs/sshKeyForService.md.
   */
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
      // An account token naming someone else is refused rather than ignored: silently handing
      // back your own key for a request that asked for another's would read as success.
      if (!service && asked && subFor(asked) !== bearer)
        return res
          .status(403)
          .json({ error: "an account token can only ask for its own key" });
      // `subFor` because the two halves spell a person differently — the file service knows
      // the email the browser sent it, this side files everything under the OIDC subject.
      const owner = service ? subFor(asked) : bearer;
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
          // Refreshed here too, not only in /tree: this list carries the projects the section
          // LINKS to, so a mirror nobody fetched hands out a folder the clone no longer has,
          // and l8 opens on a project that is not there. Detached and freshness-gated, so it
          // costs this request nothing; `bump()` is what brings the new list to the poll.
          const st = ensure(sub, r.id, r.uri);
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
          return { ...r, name: nameOf(r), ...st, branch, projects };
        }),
      );
      res.json({ repos, revision: revision(sub) });
    }),
  );

  /**
   * The URI behind a short name — what l8 and m9 ask on the way in.
   *
   * A project's address is `/<name>/<project>`, so an editor arrives holding a name and
   * nothing else. It must not hold the URI: that carries a host, a port and a user, and an
   * address bar is copied, bookmarked and pasted into chat. pl8 owns the repositories, so pl8
   * is what turns the readable half back into the thing git is given.
   *
   * Registered before `/:id/*`: `by-name` is not a repository id (those are hashes), but the
   * reader should not have to know that to be sure.
   */
  router.get(
    "/by-name/:name",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const matches = findReposByName(sub, req.params.name);
      if (!matches.length)
        return res.status(404).json({
          error: `no repository called '${req.params.name}' — add it in the médiathèque's Projets section, or open the project from there`,
        });
      // Ambiguous is not "pick one": see findReposByName.
      if (matches.length > 1)
        return res.status(409).json({
          error: `'${req.params.name}' names ${matches.length} repositories here (${matches
            .map((r) => r.uri)
            .join(
              ", ",
            )}) — open the project from the médiathèque's Projets section`,
        });
      const repo = matches[0];
      res.json({ id: repo.id, name: nameOf(repo), uri: repo.uri });
    }),
  );

  /**
   * The LIBRARY repository — the modules and chains every project of this account inherits.
   *
   * Registered before `/:id/*` for the reason `by-name` is: `libraries` is not a repository id,
   * and the reader should not have to know that ids are hashes to be sure of it.
   *
   * `null` rather than a 404 for "none set": it is the ordinary state of a new account, and it
   * is a state the callers ACT on — pl8 draws the card that asks for one, and l8 refuses to
   * open a project (see packages/project-shell/docs/launch.md). A 404 would make both of them
   * tell "not configured" apart from "the service is down" by reading a status code.
   */
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

  /**
   * Point them at a repository, or move them to another one.
   *
   * PUT and not POST: there is one, so this SETS rather than adds, and doing it twice with the
   * same URI has to be the same as doing it once.
   */
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
      // Same key as every other repository, and the mirror below cannot run without one.
      await generateKey(keyDirFor(sub), `studio-${sub}`);
      const repo = setLibrariesRepo(sub, uri);
      // Mirrored like any other repository — not because a workspace reads it through the
      // mirror (it clones the real thing as a submodule), but so this screen can say whether
      // the URI is one git will actually answer for, before a machine tries it.
      res.json({
        libraries: { ...repo, name: nameOf(repo) },
        ...ensure(sub, repo.id, repo.uri),
      });
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
