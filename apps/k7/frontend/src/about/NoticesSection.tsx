// NoticesSection.tsx — the third-party notices: searchable, filtered by where a component ships,
// each one opened to read its own notice and the standard licence texts it names. A text is
// rendered only while open: hundreds of licences in the DOM at once is a page that stalls.

import notices from "virtual:k7-notices";
import { ChevronDown, ChevronRight, ExternalLink } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { type ReactNode, useMemo, useState } from "react";
import type { NoticeEntry, Where } from "../../notices/types";
import { m } from "../paraglide/messages.js";
import { Action, Section } from "../settings/Section";
import { LicenseText } from "./LicenseText";
import { countByWhere, filterNotices, WHERES } from "./noticeFilter";

const WHERE_LABELS: Record<Where, () => string> = {
  web: () => m["about.where.web"](),
  server: () => m["about.where.server"](),
  engine: () => m["about.where.engine"](),
  desktop: () => m["about.where.desktop"](),
  android: () => m["about.where.android"](),
};

/** A toggle row whose body exists only while it is open. */
function Disclosure({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-neutral-800/40"
      >
        <Icon className="size-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-neutral-200 text-sm">
          {label}
        </span>
        {detail && (
          <span className="shrink-0 truncate text-faint text-xs">{detail}</span>
        )}
      </button>
      {open && <div className="pb-2">{children()}</div>}
    </div>
  );
}

function EntryBody({ entry }: { entry: NoticeEntry }) {
  const [standard, setStandard] = useState<string | null>(null);
  const text = entry.text ? notices.texts[entry.text] : null;
  return (
    <div className="flex flex-col gap-2 px-4 text-neutral-400 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        <span>{entry.where.map((w) => WHERE_LABELS[w]()).join(", ")}</span>
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-neutral-300 hover:underline"
          >
            <ExternalLink className="size-3" />
            {m["about.notices.homepage"]()}
          </a>
        )}
      </div>
      {entry.note && <p className="pl-5">{entry.note}</p>}
      {entry.shipped && (
        <p className="pl-5">
          {m["about.notices.shipped"]({ where: entry.shipped })}
        </p>
      )}
      {text ? (
        <LicenseText text={text} />
      ) : (
        !entry.shipped && (
          <p className="pl-5">
            {m["about.notices.noText"]({ license: entry.license })}
          </p>
        )
      )}
      {entry.standards.length > 0 && (
        <div className="flex flex-wrap gap-2 pl-5">
          {entry.standards.map((id) => (
            <Action
              key={id}
              onClick={() => setStandard((s) => (s === id ? null : id))}
            >
              {m["about.notices.standard"]({ id })}
            </Action>
          ))}
        </div>
      )}
      {standard && <LicenseText text={notices.standards[standard] ?? ""} />}
    </div>
  );
}

export function NoticesSection() {
  const [query, setQuery] = useState("");
  const [where, setWhere] = useState<Where | null>(null);
  const counts = useMemo(() => countByWhere(notices.entries), []);
  const shown = useMemo(
    () => filterNotices(notices.entries, query, where),
    [query, where],
  );
  return (
    <Section
      title={m["about.notices.title"]()}
      hint={m["about.notices.hint"]()}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={m["about.notices.search"]()}
          aria-label={m["about.notices.search"]()}
        />
        <div className="flex flex-wrap gap-2">
          <Action onClick={() => setWhere(null)} disabled={where === null}>
            {m["about.where.all"]({ count: String(notices.entries.length) })}
          </Action>
          {WHERES.map((w) => (
            <Action key={w} onClick={() => setWhere(w)} disabled={where === w}>
              {`${WHERE_LABELS[w]()} (${counts[w]})`}
            </Action>
          ))}
        </div>
        <p className="text-faint text-xs">
          {m["about.notices.count"]({
            shown: String(shown.length),
            total: String(notices.entries.length),
          })}
        </p>
      </div>
      {shown.map((e) => (
        <Disclosure
          key={`${e.name}@${e.version ?? ""}`}
          label={e.version ? `${e.name} ${e.version}` : e.name}
          detail={e.license}
        >
          {() => <EntryBody entry={e} />}
        </Disclosure>
      ))}
    </Section>
  );
}
