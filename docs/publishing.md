# Published packages — the four apps outside this repository consume by version

Every `@studio/*` package is consumed inside this tree as raw source through npm workspaces, and
almost all of them stay `private`. Four do not: they are published to a private npm registry,
for the apps that live in their own repositories and reach studio through them alone.

| package | what a consumer takes from it |
|---|---|
| `@studio/web-protocol` | the addresses — which origin each studio service answers on, the workspace and project listings |
| `@studio/engine-protocol` | the engine wire — the state frames and the compiled document's types |
| `@studio/engine-browser` | the engine probe and claim — reaching an engine from a browser, the lease |
| `@studio/project-shell` | the project gate and the file routes — `./gate`, `./files`, `./launch` |

## Why exactly these four

They are the whole contract between studio and an app outside it. The closure is closed: `engine-browser` needs
`engine-protocol` and `web-protocol`, `web-protocol` needs `engine-protocol`, and `project-shell`
needs `web-protocol`. `project-shell`'s `./project` entry also names `song-schema`, `graph-model`
and `engine-protocol`, which is why those are OPTIONAL peers: a consumer that does not import that entry
never installs the song model. `@frediverse/ui` and `react` are peers too — a consumer brings its
own, from its copy of `commons/`. Publishing a fifth package means a consumer has started depending
on something new; that is a decision to make on purpose, not a side effect of an import.

## Raw TypeScript, by design

A published package ships what the workspace consumes: `.ts` sources, `exports` pointing at them,
and its `docs/`. There is no build step and no `dist/`. The consumer's bundler compiles them, the
same way it compiles its own code, so a package reads identically inside and outside this tree and
nobody maintains a second, compiled shape of it. Tests and `tsconfig.json` are left out by each
package's `files` list. The cost: a consumer must run a TypeScript-aware bundler and accept the
`.ts` extension in imports.

## Versions

The four move together on semver, starting at `0.1.0`. A breaking change to anything an `exports`
subpath exposes — a removed or renamed export, a changed signature, a narrowed type — bumps the
major, and an addition the minor. While the version is `0.x`, `^` reads one place further right,
so the rule shifts with it: a breaking change bumps the minor, an addition the patch. A consumer pins them with `^`, so a
breaking change without a bump reaches it on its next install. Between themselves the four name
each other with `^`; every other workspace consumer here names them with `*` and always gets the
tree's copy.

## Not wired yet

The registry does not exist yet and no CI step publishes. The packages are publishable — no
`private`, a `version`, `publishConfig.access` set to `restricted` — but the registry URL is
deliberately absent from every `package.json`: it will come from the CI's `.npmrc`, so the same
manifest publishes wherever that file points.
