// FooterTab.tsx — the footer's panel buttons drawn as TABS: the shared header's tabs (@frediverse/ui's
// app-header) upside down, hanging from the footer's top rule, the active one opening into what it shows.
// The tabs only read as tabs over the footer's tint, the header's own (docs/shell.md).

import { Button, type ButtonProps } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";

/** A row of tabs through the footer's whole height, over its top rule; `dense` is the phone's thinner footer. */
export function FooterTabs({
  dense = false,
  children,
}: {
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <nav
      className={cn(
        "flex items-stretch gap-0.5 self-stretch",
        dense
          ? "-mb-0.5 -mt-[calc(0.125rem+1px)]"
          : "-mb-1 -mt-[calc(0.25rem+1px)]",
      )}
    >
      {children}
    </nav>
  );
}

/** One tab: borderless at rest, the page's background and three sides of the rule when `active`; `plain` is a phone menu's ordinary toggle. */
export function FooterTab({
  active,
  plain = false,
  className,
  ...props
}: ButtonProps & { active: boolean; plain?: boolean }) {
  if (plain)
    return (
      <Button
        size="icon"
        variant={active ? "default" : "ghost"}
        aria-pressed={active}
        className={className}
        {...props}
      />
    );
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      className={cn(
        "relative h-auto rounded-none border border-t-0 border-transparent px-2",
        active &&
          "border-border bg-background bg-clip-padding text-foreground hover:bg-background hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
