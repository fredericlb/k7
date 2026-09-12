# Tiltfile — the dev session: `npm run dev` (i.e. `tilt up`) starts every dev server as
# its own restartable resource, web UI at http://localhost:10350, instead of one TUI
# where a crash is all-or-nothing. The task list comes from scripts/tilt-tasks.mjs
# (derived from the workspace, so an app joins by existing). turbo keeps build/test —
# Tilt only owns `dev`. See docs/dev.md and docs/remote.md.

version_settings(check_updates=False)
analytics_settings(enable=False)

tasks = decode_json(str(local("node scripts/tilt-tasks.mjs", quiet=True)))

for t in tasks:
    local_resource(
        t["label"],
        serve_cmd="npm run dev",
        serve_dir=t["dir"],
        labels=[t["group"]],
        allow_parallel=True,
    )

# Remote Control: a row of its own, since it belongs to no package — docs/dev.md.
local_resource(
    "claude-rc",
    serve_cmd="claude rc",
    serve_dir=".",
    labels=["tools"],
    allow_parallel=True,
)
