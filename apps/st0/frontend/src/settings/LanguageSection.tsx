// LanguageSection.tsx — which language the app speaks. The one setting on this panel that asks no
// machine anything: it is the BROWSER's, kept in its own localStorage and travelling with nothing.
// See ../../docs/settings.md.

import { useLocale } from "../i18n";
import { Action, Row, Section } from "./Section";

/** Each locale named in ITS OWN language: a list you pick from has to read in the language you want. */
const NAMES: Record<string, string> = { en: "English", fr: "Français" };
const nameOf = (l: string): string => NAMES[l] ?? l;

export function LanguageSection() {
  const { locale, locales, setLocale } = useLocale();
  return (
    <Section
      title="Language"
      hint="Kept in this browser and nowhere else: the same account on another machine starts in English again."
    >
      <Row
        label={nameOf(locale)}
        detail="English unless you say otherwise — what the browser asks for is not read."
      >
        {locales.map((l) => (
          <Action
            key={l}
            onClick={() => setLocale(l)}
            // The one you are reading is the one you cannot pick: a button that changes nothing is a button that looks broken.
            disabled={l === locale}
            title={
              l === locale ? "Already reading this" : `Read in ${nameOf(l)}`
            }
          >
            {nameOf(l)}
          </Action>
        ))}
      </Row>
    </Section>
  );
}
