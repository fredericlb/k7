// SshKeyCard.tsx — la clé de déploiement du studio. Elle est générée ICI, par st0, parce que
// c'est ce service qui détient les dépôts ; la machine du moteur en récupère une copie quand
// elle doit cloner. Une seule clé à coller chez l'hébergeur git. Voir packages/git-repos/docs/keys.md.

import { Button } from "@frediverse/ui/button";
import { Check, Copy, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { projects } from "./api";

export function SshKeyCard() {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void projects
      .sshKey()
      .then((r) => setKey(r.publicKey))
      .catch((e: Error) => setError(e.message));
  }, []);

  const generate = () => {
    setBusy(true);
    setError(null);
    void projects
      .generateSshKey()
      .then((r) => setKey(r.publicKey))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!key) return;
    void navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col gap-2 border-t px-6 py-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="h-4 w-4" /> Clé de déploiement
      </div>
      <p className="text-xs text-muted-foreground">
        Ajoutez cette clé publique chez votre hébergeur git (clé de déploiement
        ou clé SSH de compte) avant d'ajouter un dépôt. La même clé sert à lire
        le dépôt ici et à le cloner sur la machine de votre moteur.
      </p>
      {key ? (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
            {key}
          </code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Aucune clé n'a encore été générée.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            disabled={busy}
          >
            Générer la clé
          </Button>
        </div>
      )}
      {error && (
        <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}
    </div>
  );
}
