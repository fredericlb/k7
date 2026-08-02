# enginePlugin — the authoring → engine plugin mapping

`enginePlugin()` (project.ts) maps an AUTHORED module plugin
(`plugin: { type, name }` in module.yaml) to the `type` and `name` the engine's
`PluginDoc` wants. The two models differ, and both have to keep working.

## What the authoring model states

A **format**:

- `"internal"` — a built-in, its Tracktion xmlTypeName carried in `name`
  (e.g. `{type: "internal", name: "4osc"}`)
- an external format (`"vst3"`, `"au"`, …) — `name` is the plugin's real name, looked
  up in the engine's scan cache

## What the engine's wire format expects

Older, and narrower: `type` holds EITHER the built-in's xmlTypeName OR the external
format. So the mapping is:

| authored | engine `type` | engine `name` |
|---|---|---|
| `internal` | the xmlTypeName (from `name`) | the module's display name (`fallback`) |
| an external format | the format | the authored plugin name, else `fallback` |
| anything else (legacy) | passed through — already an xmlTypeName | the authored name, else `fallback` |

The legacy row is what lets a project authored before the `"internal"` model compile
unchanged, so no existing song needs migrating.
