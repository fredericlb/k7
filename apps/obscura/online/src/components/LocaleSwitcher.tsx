import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { Globe } from "lucide-react";
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
