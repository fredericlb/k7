# Inter-service tokens

`npm run tokens` mints the tokens one studio service uses to call another and writes each one
where its consumer reads it. Idempotent — a token that still verifies is left alone — so it is
safe on every checkout, and it is the answer to "where do I get a token from".

```
npm run tokens              # ensure every link has a working token
npm run tokens -- --dry-run # say what it would do
npm run tokens -- --force   # re-mint even the ones that still work
```

## Why a script can mint one at all

A token is a **self-contained** `{sub, iat}` signed with HMAC-SHA256
(`commons/packages/oidc/apiToken.ts`): no server-side storage, no per-token record, nothing to
register. Whoever holds the signing secret can mint one offline — no HTTP, no login, no running
service. The secret lives in `env.yaml` under the service that *verifies*, so the script needs
only that file.

That also states the tool's boundary plainly: this is for a **checkout**, where one `env.yaml`
holds every service's secrets. A musician's laptop syncing the hosted médiathèque has no
`env.yaml`, so its token still has to arrive over the wire — that is what `POST /api/token` is
for. (Under `/pl8` — see the URL table below.)

## What it does, per link

The `LINKS` table in `scripts/tokens.mjs` is the whole configuration. Each entry names the
issuing service, the identity the callee will see, and where the caller reads its token:

| link | signed with | `sub` | written to |
|---|---|---|---|
| st0 → pl8 | `pl8-backend.API_TOKEN_SECRET` | `service:st0` | `~/.studio/engine-tray.json` (`mediatekToken`) |
| k7 → pl8 | the same secret | `service:k7` | `env.yaml` (`k7-backend.MEDIATEK_TOKEN`) |

The env section is `pl8-backend`, and that spelling matters: a section name `env.yaml` does not
recognise falls back to `common` alone, silently, so a wrong one produces a configuration that
looks like it worked. (`MEDIATEK_TOKEN` and `mediatekToken` keep their names on purpose — they
name the médiathèque, the concept, which is what pl8 serves.)

One secret, because one service verifies both — and a `sub` each, so the library's log says
which service wrote. A third caller is one more row.

**The secret is generated on first run** when the service has none. Left unset, the médiathèque
falls back to `${SESSION_SECRET}:pl8` — which works, and is exactly what nobody should rely
on: rotating the session secret would then log everyone out *and* revoke every machine's sync in
one move. Restart the pl8 backend after a secret is written; a token signed with the new
one is refused by a process still holding the old.

**The token goes to the tray settings, not to `env.yaml`,** because its consumer is the file
service — spawned by the supervisor beside the engine — and that credential belongs to a
machine, not to a deployment. `env.yaml` is committed-adjacent and per checkout; the two are
different scopes and the script writes to both accordingly.

**`devUrl` is the one URL anything here writes,** and only into a checkout. A service sits at
a FIXED path under one origin, which is what every caller defaults to — but in a checkout that
origin goes out to the LAN proxy and straight back for nothing, so a server-to-server hop takes the
loopback port instead and the script writes it so nobody types a URL. It is written only when the
file has none and is **never** overwritten: a checkout pointed somewhere deliberate is a checkout
somebody set up on purpose. The st0 → pl8 link needs none, since the file service derives its URL
from the registries the supervisor already announces to.

**A token that still verifies is left alone.** Re-minting one has a real cost: every machine
holding the old one keeps it and they all keep working, so a "refresh" that changes nothing
anywhere is only noise in two config files. `--force` overrides that, and a freshly generated
secret voids every old token whether or not it verified.

The token scheme is duplicated byte for byte from `commons/packages/oidc/apiToken.ts` rather
than imported: this is a plain node script with no TypeScript loader, and booting tsx to sign 100
bytes buys nothing. The pair is pinned by a test that mints here and verifies with the real one,
`packages/engine-host/src/tokensScript.test.ts`, which lives there because that package owns the
consumer half. `env.yaml` is edited as a yaml DOCUMENT, so its comments survive.

## Rotation and revocation

There is no per-token revocation, by construction. Rotate `API_TOKEN_SECRET` and every token
signed with it dies at once; run the script again to re-mint the ones this machine needs. That
is the trade the scheme makes, and it is why the secret is per service rather than shared.

## The URLs are not configuration

`packages/web-protocol/services.ts` holds the one table, under a single origin —
`https://studio.frediver.se/<service>` in production:

| service | path |
|---|---|
| `st0` | `""` — the editor is the front door, so it answers the ORIGIN itself |
| `pl8` | `/pl8` |
| `k7` | `/k7` |

st0's empty path is a real entry rather than a special case at each call site — every caller
already concatenates.

**`/auth/*` belongs to the same service**, and can only: the registered `redirect_uri` has no
prefix, so the flow is served by the service with no prefix — st0's backend. The dev proxy
mirrors what the production edge does, so dev and production differ by the origin and nothing
else.

So nothing asks for a service's URL:

- the supervisor **derives** the médiathèque from the registries it already announces to
  (`mediatekUrlFor`) rather than reading a URL out of `~/.studio/engine-tray.json`. A
  hand-typed second copy of a fact already on disk is precisely how a machine ends up
  heartbeating to one studio and syncing from another;
- the st0 frontend derives it from `window.location.origin`, so no host is named at build time;
- k7's backend **defaults** to `serviceUrl(STUDIO_ORIGIN, "pl8")`, so a deployment sets
  nothing. (`"pl8"` is the `StudioService` key; `"mediatek"` is not one and would not typecheck.)

### The one exception, and the script writes it

A server-to-server hop takes the loopback port rather than the public URL — `SERVICE_PORTS` in
the same table, `localServiceUrl()`. It would send a call from one backend out to the LAN
server and straight back for no reason, and it would fail outright the moment the proxy is
unreachable while both services are up and fine.

`npm run tokens` writes that line (`k7-backend.MEDIATEK_URL`) when the file has none, so nobody
types a URL. It never overwrites one: a checkout pointed somewhere deliberate is a checkout
somebody set up on purpose.

st0's half needs no such line — the file service is on the engine's machine and reaches the
studio the same way a browser does, over a certificate the OS already trusts.
