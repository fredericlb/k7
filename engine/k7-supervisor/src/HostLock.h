// HostLock.h — one supervisor per machine, held in `<state>/engine-host.pid`. Two would each ADOPT
// the one engine, and shutdown does not spare an adopted engine, so quitting the second would stop
// the first's. The holder keeps rewriting the file, and one nobody refreshed goes stale: a pid is
// not an identity, and a dead one gets reused. See docs/supervisor.md.

#pragma once

namespace k7::hostlock {

/** Who holds the lock (-1 for a fresh one naming nobody yet), or 0; a stale or foreign-dead lock is removed on the way. */
int heldBy();

/** Take it by exclusive create, or return the pid that has it (-1 when unknown); 0 means it is ours now. */
int acquire();

/** Rewrite our pid, which is what keeps the lock fresh — called on the loop every two seconds. */
void refresh();

/** Let go, but only if the file still names us. */
void release();

/** How often `refresh` must run for the lock to stay believed. */
constexpr int kRefreshMs = 2000;

}  // namespace k7::hostlock
