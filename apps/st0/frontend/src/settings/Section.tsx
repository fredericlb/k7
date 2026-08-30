// Section.tsx — the shared furniture of the settings screen: the tab strip, a titled block, a
// row, and the one button shape every action uses. Here rather than repeated four times, so the
// screen reads as one surface and a fifth section costs a title.

import type { ComponentType, ReactNode } from "react";

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40">
      <header className="border-neutral-800 border-b px-4 py-3">
        <h2 className="font-medium text-neutral-200 text-sm">{title}</h2>
        {hint && <p className="mt-1 text-neutral-500 text-xs">{hint}</p>}
      </header>
      <div className="divide-y divide-neutral-800/60">{children}</div>
    </section>
  );
}

/** One line: what it is on the left, what you can do about it on the right. */
export function Row({
  label,
  detail,
  children,
}: {
  label: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-neutral-200 text-sm">{label}</div>
        {detail && (
          <div className="truncate text-neutral-500 text-xs">{detail}</div>
        )}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}

/**
 * A disabled action still says WHY where it can. The tray could only grey a row out; a page
 * has room for the sentence, which is the one thing the menu could never do.
 */
export function Action({
  onClick,
  disabled,
  title,
  children,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-red-900/60 text-red-300 hover:enabled:bg-red-950/40"
          : "border-neutral-700 text-neutral-300 hover:enabled:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The strip above the sections. Not the window's tabs — those hold projects (see
 * apps/studio-desktop/docs/tabs.md); these only choose which part of one page is drawn.
 */
export function Tabs<T extends string>({
  tabs,
  current,
  onPick,
}: {
  tabs: readonly {
    id: T;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }[];
  current: T;
  onPick: (id: T) => void;
}) {
  return (
    <nav className="flex gap-1 border-neutral-800 border-b">
      {tabs.map(({ id, label, icon: Icon }) => {
        const on = id === current;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onPick(id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              on
                ? "border-neutral-300 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
