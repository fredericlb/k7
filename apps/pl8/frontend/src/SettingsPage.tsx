// SettingsPage.tsx — « Paramètres », a tabless section reached from the cog, like k7's
// /settings: who is signed in, and the instance's slskd settings. See ../docs/settings.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { ArrowLeft, LogOut } from "@frediverse/ui/icons";
import { auth, currentUser } from "./api";
import { SlskdSettings } from "./SlskdSettings";

export function SettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Morceaux
          </Button>
          <h2 className="text-lg font-semibold">Paramètres</h2>
        </div>

        <Card className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div>
            <div className="text-xs text-muted-foreground">
              Connecté en tant que
            </div>
            <div className="font-medium">{currentUser() || "—"}</div>
          </div>
          <Button variant="outline" onClick={() => void auth.logout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Se déconnecter
          </Button>
        </Card>

        <SlskdSettings />
      </div>
    </div>
  );
}
