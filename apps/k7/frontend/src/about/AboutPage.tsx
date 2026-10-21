// AboutPage.tsx — `/about`: k7's name and version, its licence with the full text, the link to its
// source, and every third-party notice. The source link is not courtesy: the engine links JUCE under
// the AGPLv3, so a network user must be offered the source. See ../../docs/about.md.

import { ExternalLink } from "@frediverse/ui/icons";
import { lazy, Suspense, useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { HomeShell } from "../projects/HomeSidebar";
import { PageFrame } from "../projects/PageFrame";
import { Action, Row, Section } from "../settings/Section";
import { VERSION } from "../version";
import { LicenseText } from "./LicenseText";

/** Where the complete source is published: the address the AGPL's offer names. */
export const SOURCE_URL = "https://github.com/fredericlb/k7";

/** The notices and their texts, a chunk of their own that only this page fetches. */
const NoticesSection = lazy(() =>
  import("./NoticesSection").then((x) => ({ default: x.NoticesSection })),
);

/** k7's own licence, the root LICENSE, fetched with the notices since it is one of their texts. */
const OwnLicense = lazy(() =>
  import("virtual:k7-notices").then((x) => ({
    default: () => <LicenseText text={x.default.standards["GPL-3.0"] ?? ""} />,
  })),
);

export function AboutPage() {
  const [showLicense, setShowLicense] = useState(false);
  const local = useLocalApp();
  return (
    <HomeShell subtitle={m["about.title"]()}>
      <PageFrame title={m["about.title"]()} narrow>
        <Section title="k7" hint={m["about.tagline"]()}>
          <Row
            // version.ts is the frontend's one version source, whatever feeds it (../../docs/about.md).
            label={m["about.version"]({ version: VERSION })}
            detail={
              local?.engine
                ? m["settings.desktopVersion"]({ version: local.version })
                : undefined
            }
          />
        </Section>

        <Section title={m["about.license.title"]()}>
          <Row label={m["about.license.body"]()}>
            <Action onClick={() => setShowLicense((s) => !s)}>
              {showLicense
                ? m["about.license.hide"]()
                : m["about.license.show"]()}
            </Action>
          </Row>
          {showLicense && (
            <Suspense fallback={null}>
              <OwnLicense />
            </Suspense>
          )}
        </Section>

        <Section
          title={m["about.source.title"]()}
          hint={m["about.source.hint"]()}
        >
          <Row label={SOURCE_URL}>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-neutral-700 px-2.5 py-1 text-neutral-300 text-xs transition-colors hover:bg-neutral-800"
            >
              <ExternalLink className="size-3.5" />
              {m["about.source.open"]()}
            </a>
          </Row>
        </Section>

        <Suspense
          fallback={
            <p className="text-muted-foreground text-xs">
              {m["about.notices.loading"]()}
            </p>
          }
        >
          <NoticesSection />
        </Suspense>
      </PageFrame>
    </HomeShell>
  );
}
