import { useLocale } from "../lib/i18n";

// Language names stay in their own language and are deliberately NOT in the
// catalogue: someone who has landed in a language they can't read needs to
// recognise their own in the list.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
};

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocale();

  return (
    <select
      className="picker"
      value={locale}
      aria-label="Language"
      onChange={(e) => setLocale(e.target.value as typeof locale)}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {NATIVE_NAMES[l] ?? l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
