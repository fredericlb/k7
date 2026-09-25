# moduleResolve — one answer to "what does this module run with?"

A module inherits from the module it `extends` — `@library/audio/amp/marshall`, and whatever
*that* extends, with no depth limit.

A project's nodes are files in a flat `nodes/` folder and name what they use with
`extends` like anything else, so inheritance is ONE mechanism (see `docs/nodes.md`).
The shared library files nodes under a module, and those merge through the generic they
sit under.

One mechanism means one implementation, and that is what this file is: a copy of the merge
drifts, and drifts silently. A base resolved with a single direct lookup where everything else
recurses shows a module three levels deep the wrong params in the graph and the right ones in
the engine.

## The brand is the mechanism

`ResolvedModule` carries a phantom brand: `declare const RESOLVED: unique symbol`, never
written at runtime. Nothing serializes differently, and it costs nothing — but
`resolveModule` is the only way to produce one, so an inline copy of the merge does not
typecheck against the consumers that ask for a `ResolvedModule`. Deleting a copy is the easy
part; this is what stops one coming back.

## The undefined rule

`mergeAuthored` skips a child value that is `undefined`, and this is the whole fix rather
than a nicety.

The loader DECORATES every module it reads, and decoration writes the file-valued fields and
`preset` unconditionally — at `undefined` when the module declares none. A plain
`{...parent, ...child}` therefore has the child ERASE its parent's file every time, and every
call site grows its own `?? base?.nam`, `?? base?.jsdsp`, `?? base?.preset` — five of them in
nodeProject alone, that many separate chances to forget one.

Fixing the decoration instead would touch every raw consumer without TypeScript flagging a
single one. Fixing the merge is total and local.

Note what it is NOT: skipping `undefined` is not skipping falsy. A module that silences an
inherited `gain: 3` by writing `gain: 0` means it, and `source: ""` clears an inherited
slice source. Pinned by a test.

## What is never inherited

`kind`, `inputs`, `category`, `name`, `file`, `node`, `home` — `OWN_ONLY`.

These say WHERE the module lives, not what it does. A module filed under `audio/` that
extends an instrument is still an effect: its icon comes from its own folder, its typed
input ports from its own type, its chain key from its own file. Stated as a list rather than
left to the accident that an absent key and a key set to `undefined` merge differently, since
decoration is free to touch any of them.

**"Never" means "when it has them", and the difference is load-bearing.** The rule is that
the child wins if the KEY IS PRESENT. A node in the project's flat `nodes/` has no
type folder to read `kind`, `inputs` or `category` off, so the loader leaves them absent and
they arrive from what it extends. That is the whole of how a flat folder can work — there is
no node-shaped case anywhere in this file.

## The alternative is applied ONCE, at the outermost module

`resolveModule` is two steps and the order is the point: `extends` is folded first, then the one
selected attribute set is merged over the result. So an alternative always wins — it is the last
thing said about the module — and it can pick from a list its PARENT declared, which is how a
shared amp offers `clean`/`crunch` and each node chooses.

The recursion therefore calls `foldExtends`, not `resolveModule`. Applying the alternative at every
level would mean a parent's own choice was merged in before the child's, and `base + clean + crunch`
is not what `alternative: crunch` says. See [alternatives.md](alternatives.md).

`foldExtends` is cycle-guarded by ref: a chain that loops stops at the repeat and resolves what it
read so far, because a bad `extends` should cost the inheritance, not the project. A ref that names
nothing is likewise not an error here — `validate()` is what reports it.

## Re-resolving what a module NAMED, against the whole chain

`withInheritedFiles` re-resolves a module's file-valued params and its chosen `base:` against the
folders of the WHOLE ancestry, nearest first.

A module may name a file its parent carries — that is the normal way to use a shared amp: a thin
local module `extends` it and says which profile to load, while the profiles live in the shared
folder. Each module resolves its own refs against its own folder when it is loaded, which for that
local module is a folder holding nothing, so without this pass the ref comes back unresolved and
`mergeAuthored` keeps the PARENT's path: the panel shows the chosen name and the engine loads the
inherited file, silently the wrong sound, which is worse than none.

A chosen `base:` fails in exactly that way and is fixed here for exactly that reason. The bases are
snapshotted onto the shared module — the one that names the plugin and travels with its sounds —
and the local module picks one by name. Resolved against its own folder alone, the pick finds
nothing and the merge keeps the parent's default preset: the panel says `warm` and the engine loads
something else.

Nearest folder first, matching the order `moduleAssetChoices` and `moduleBaseChoices` offer them
in — the list you pick from and the path you get must agree. Only what THIS module named is
re-resolved: a ref it inherited was already resolved by the module that declared it, against the
folder that holds the file, and re-doing it here would blank it. A `base:` miss leaves the merged
answer alone rather than blanking it, since a `base:` naming nothing is a module still worth
playing on its default state.

## Where resolution happens

Once, at the top, so nothing downstream knows inheritance exists:

- `buildGraph` resolves both `modules` and `moduleRefs` before `toModule` normalises them;
- `compileNodeProject` resolves the map `withChainModuleRefs` hands it;
- `projectHints` resolves its own map.

`resolvedType`, `resolvedRack` and `resolvedUI` take ONE module rather than a
`(base, module)` pair, because after resolution there is no pair. `resolvedUI` also drops
`hidden` widgets: `hidden` exists only because an inherited widget cannot be unset, so it
is a wire detail, and dropping it here means no panel has to remember to.

`resolvedType` is distinct from `kind` (its type folder) and from `plugin.type` (the xmlTypeName):
it is the authored discriminator that decides whether the engine gets a plugin or a sampler.
`resolvedRack` is total — a module with no rack answers an empty one, so the rack branch never has
to ask twice whether there is anything to read.

`resolvedCc` VALIDATES rather than trusts, because it also runs over a module read back from a
cached doc, which has not been through the schema. A map that fails reads as none, the same way a
malformed panel does: a typo in one binding must not stop the graph drawing.
