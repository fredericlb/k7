// VisibilityPicker.tsx — who opens a page by its nametag: its owner, anyone signed in, or anyone.
// Shown on the new-page form and on the page itself — ../../rehearsal-server/docs/pages.md.

import { Button } from "@frediverse/ui/button";
import {
  PAGE_VISIBILITIES,
  type PageVisibility,
} from "@studio/rehearsal-shared/pageVisibility";
import { m } from "../paraglide/messages.js";

const LABELS: Record<PageVisibility, () => string> = {
  private: () => m["page.visibility.private"](),
  authenticated: () => m["page.visibility.authenticated"](),
  public: () => m["page.visibility.public"](),
};

const HINTS: Record<PageVisibility, () => string> = {
  private: () => m["page.visibility.privateHint"](),
  authenticated: () => m["page.visibility.authenticatedHint"](),
  public: () => m["page.visibility.publicHint"](),
};

interface Props {
  value: PageVisibility;
  onChange: (visibility: PageVisibility) => void;
  disabled?: boolean;
}

export function VisibilityPicker({ value, onChange, disabled }: Props) {
  return (
    <div
      className="row"
      style={{ gap: 6 }}
      role="radiogroup"
      aria-label={m["page.visibility.label"]()}
    >
      {PAGE_VISIBILITIES.map((v) => (
        <Button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          variant={value === v ? "default" : "outline"}
          size="sm"
          title={HINTS[v]()}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {LABELS[v]()}
        </Button>
      ))}
    </div>
  );
}

/** The one sentence saying who opens a page, for the page itself. */
export const visibilityHint = (v: PageVisibility): string => HINTS[v]();
