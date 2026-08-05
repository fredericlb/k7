# moduleResolve — one answer to "what does this module run with?"

A module inherits from the module it `extends` — `@library/audio/amp/marshall`, and whatever
*that* extends, with no depth limit.

That used to be two things: the `extends` chain, and the generic an instance sat under. A
project's instances are files in a flat `instances/` folder now and name what they use with
`extends` like anything else, so there is one mechanism instead of two (see
`docs/instances.md`). The shared library still files instances under a module, and those
merge the old way.

That merge used to exist in **five** places: `mergeModule` in loader.ts, four `effective*`
helpers in graph.ts, and three inline copies (graphDoc.ts, nodeProject.ts, patternClock.ts,
hints.ts). Two had drifted — graphDoc resolved the base with a single direct lookup where
everything else recursed, so a module three levels deep showed the wrong params in the
graph and the right ones in the engine.

## The brand is the mechanism

`ResolvedModule` carries a phantom brand: `declare const RESOLVED: unique symbol`, never
written at runtime. Nothing serializes differently, and it costs nothing — but
`resolveModule` is the only way to produce one, so a sixth inline copy would not typecheck
against the consumers that ask for a `ResolvedModule`. Deleting the five copies was the
easy part; this is what stops them coming back.

## The undefined rule

`mergeAuthored` skips a child value that is `undefined`, and this is the whole fix rather
than a nicety.

The loader DECORATES every module it reads, and decoration writes `ir`, `nam`, `jsdsp` and
`preset` unconditionally — at `undefined` when the module declares none. A plain
`{...parent, ...child}` therefore had the child ERASE its parent's impulse response every
time. That is why the call sites had each grown their own `?? base?.ir`, `?? base?.nam`,
`?? base?.jsdsp`, `?? base?.preset` — five of them in nodeProject alone, four separate
chances to forget one.

Fixing the decoration instead would have touched every raw consumer without TypeScript
flagging a single one. Fixing the merge is total and local.

Note what it is NOT: skipping `undefined` is not skipping falsy. A module that silences an
inherited `gain: 3` by writing `gain: 0` means it, and `source: ""` clears an inherited
slice source. Pinned by a test.

## What is never inherited

`kind`, `inputs`, `category`, `name`, `file`, `instance`, `home` — `OWN_ONLY`.

These say WHERE the module lives, not what it does. A module filed under `audio/` that
extends an instrument is still an effect: its icon comes from its own folder, its typed
input ports from its own type, its chain key from its own file. Before, this held by
accident — an absent key and a key set to `undefined` merged differently — and would have
broken the moment decoration touched one of them.

**"Never" means "when it has them", and the difference is load-bearing.** The rule is that
the child wins if the KEY IS PRESENT. An instance in the project's flat `instances/` has no
type folder to read `kind`, `inputs` or `category` off, so the loader leaves them absent and
they arrive from what it extends. That is the whole of how a flat folder can work — there is
no instance-shaped case anywhere in this file.

## Where resolution happens

Once, at the top, so nothing downstream knows inheritance exists:

- `buildGraph` resolves both `modules` and `moduleRefs` before `toModule` normalises them;
- `compileNodeProject` resolves the map `withChainModuleRefs` hands it;
- `projectHints` and `patternClock` resolve their own maps.

`resolvedType`, `resolvedRack` and `resolvedUI` take ONE module rather than a
`(base, module)` pair, because after resolution there is no pair. `resolvedUI` also drops
`hidden` widgets: `hidden` exists only because an inherited widget cannot be unset, so it
is a wire detail, and dropping it here means no panel has to remember to.
