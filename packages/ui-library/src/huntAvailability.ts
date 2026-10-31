// huntAvailability.ts — what the add-song popin says of an automatic download that cannot run.
// The server names the blank settings by id and the host's labels word them; its own sentence is
// only read when it gave no ids (an older server, or the request itself failing). ../docs/hunt.md.

import type { HuntList, HuntSettingsGap } from "@studio/web-protocol/hunt";

/** What the popin keeps of `GET /api/hunt`: whether a download can run, and why not. */
export interface HuntAvailability {
  configured: boolean;
  missing: HuntSettingsGap[];
  reason: string | null;
  youtube: boolean;
}

/** The words the host gives for it. */
export interface HuntGapLabels {
  notSetUp: string;
  gap: Record<HuntSettingsGap, string>;
  missingList: (list: string) => string;
}

export function availabilityOf(x: HuntList): HuntAvailability {
  return {
    configured: x.configured,
    missing: x.configured ? [] : (x.missing ?? []),
    reason: x.configured ? null : x.reason,
    youtube: x.youtube,
  };
}

/** The notice's two lines, or null when the download can run. */
export function unavailableNotice(
  a: HuntAvailability,
  l: HuntGapLabels,
): { title: string; detail: string | null } | null {
  if (a.configured) return null;
  if (a.missing.length)
    return {
      title: l.notSetUp,
      detail: l.missingList(a.missing.map((k) => l.gap[k]).join(", ")),
    };
  return { title: l.notSetUp, detail: a.reason };
}
