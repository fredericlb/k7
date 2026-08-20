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
            "no SSH key yet — open st0's home page to generate one, then add it to your git host",
        });
      res.set("Cache-Control", "no-store");
      res.json({ privateKey: key, publicKey: publicKey(dir) });
    }),
  );

  /**
   * Every repository this person has REGISTERED, and nothing about what is in one.
   *
   * It answered that too, out of a bare blobless mirror of each — a second copy of what the
   * engine machine's working clone already held, a `git fetch` behind it, and blind to a project
   * committed there whose push had not landed. st0's home page asks the machine now, which is
   * the side the folders are on. What is left here is what only a hosted service can hold: the
   * list itself, which belongs to a PERSON rather than to a machine and outlives every engine.
   *
   * Synchronous again, and that is the shape of the change: there is nothing to fetch.
   */
  router.get(
    "/",
    wrap((req, res) => {
      const sub = subOf(req)!;
      const repos = listRepos(sub).map((r) => ({ ...r, name: nameOf(r) }));
      res.json({ repos, revision: revision(sub) });
    }),
  );

  /**
   * The URI behind a short name — what st0 and m9 ask on the way in.
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

  /**
   * The LIBRARY repository — the modules and chains every project of this account inherits.
   *
   * Registered before `/:id/*` for the reason `by-name` is: `libraries` is not a repository id,
   * and the reader should not have to know that ids are hashes to be sure of it.
   *
   * `null` rather than a 404 for "none set": it is the ordinary state of a new account, and it
   * is a state the callers ACT on — pl8 draws the card that asks for one, and st0 refuses to
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
      // Same key as every other repository: the machine that mounts this submodule fetches a
      // copy of it, and there has to be one to copy.
      await generateKey(keyDirFor(sub), `studio-${sub}`);
      const repo = setLibrariesRepo(sub, uri);
      // Recorded, not verified. This used to mirror the repository here so the screen could say
      // whether the URI was one git would answer for before any machine tried it; the mirror is
      // gone, and the first clone is what says so now — later, and in git's own words.
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
      // The clone st0 starts right after this cannot run without a key, and this is the first
      // moment one is needed.
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
      // Nothing else to drop: this service holds no copy of the repository any more. The
      // working clone stays on whatever machine has it, which is the honest outcome — removing
      // a name from a list must not delete somebody's files.
      res.json({ ok: true });
    }),
  );

  // `/:id/status`, `/:id/refresh` and `/:id/tree` were here, and all three were about the
  // mirror: how its fetch was doing, doing it again, and reading the tree out of it. The engine
  // machine answers the last one from a real checkout (`GET /workspace-tree`), and the other two
  // described work this service no longer does.

  return router;
}
