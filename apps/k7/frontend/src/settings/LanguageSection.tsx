// LanguageSection.tsx — which language the app speaks. The one setting on this panel that asks no
// machine anything: it is the BROWSER's, kept in its own localStorage and travelling with nothing.
// See ../../docs/settings.md.

import { useLocale } from "../i18n";
import { m } from "../paraglide/messages.js";
import { Action, Row, Section } from "./Section";

/** Each locale named in ITS OWN language: a list you pick from has to read in the language you want. */
const NAMES: Record<string, string> = { en: "English", fr: "Français" };
const nameOf = (l: string): string => NAMES[l] ?? l;

export function LanguageSection() {
  const { locale, locales, setLocale } = useLocale();
  return (
    <Section title={m["lang.title"]()} hint={m["lang.hint"]()}>
      <Row label={nameOf(locale)} detail={m["lang.detail"]()}>
        {locales.map((l) => (
          <Action
            key={l}
            onClick={() => setLocale(l)}
            // The one you are reading is the one you cannot pick: a button that changes nothing is a button that looks broken.
            disabled={l === locale}
            title={
              l === locale
                ? m["lang.current"]()
                : m["lang.readIn"]({ language: nameOf(l) })
            }
          >
            {nameOf(l)}
          </Action>
        ))}
      </Row>
    </Section>
  );
}
