import { Globe } from "@frediverse/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { useLocale } from "../lib/i18n";

// NOT in the catalogue: someone stuck in a language they cannot read must recognise their own.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
};

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocale();

  return (
    <Select value={locale} onValueChange={(v) => setLocale(v as typeof locale)}>
      <SelectTrigger size="sm" aria-label="Language">
        <Globe className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {NATIVE_NAMES[l] ?? l.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
