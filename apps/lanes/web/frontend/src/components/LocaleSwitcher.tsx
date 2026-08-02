import { useLocale } from "../i18n";

// Language names stay in their own language: someone stuck in a language they can't read must find their own.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
};

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocale();

  return (
    <select
      value={locale}
      aria-label="Language"
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {NATIVE_NAMES[l] ?? l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
