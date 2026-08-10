# Tiltfile — the dev session: `tilt up` (or the studio-tilt logon task) starts every
# dev server as its own restartable resource, web UI still at https://studio.test:10351
# (the one thing the move to st0.priv.frediver.se has NOT followed — see docs/remote.md),
# instead of one turbo TUI where a crash is all-or-nothing. The task list comes from
# scripts/tilt-tasks.mjs (same rules as scripts/dev.mjs, so an app still joins by
# existing). turbo keeps build/test — this only replaces `dev`. See docs/remote.md.

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
