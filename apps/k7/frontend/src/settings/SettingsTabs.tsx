// SettingsTabs.tsx — the tabs a settings page groups its sections under, the chosen one held in `?tab=` so a
// reload or a pasted link lands on it. A tab's sections mount only while it is shown. See ../../docs/settings.md.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

export interface SettingsTab {
  key: string;
  label: string;
  content: ReactNode;
}

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const current = tabs.find((t) => t.key === asked)?.key ?? tabs[0]?.key;
  // Replaced, not pushed: Back leaves the page rather than walking through every tab looked at.
  const choose = (key: string) =>
    setParams(
      (p) => {
        p.set("tab", key);
        return p;
      },
      { replace: true },
    );
  return (
    <Tabs value={current} onValueChange={choose}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent
          key={t.key}
          value={t.key}
          className="mt-4 flex min-w-0 flex-col gap-4"
        >
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
