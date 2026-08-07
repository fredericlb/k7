// QueueButton.tsx — la file d'attente, à droite de la barre du bas : ce qui passera ensuite,
// dans l'ordre, déplaçable et retirable. Voir ../../docs/miniPlayer.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { ChevronDown, ChevronUp, ListVideo, X } from "lucide-react";
import { usePlayback } from "./PlaybackProvider";

/** L'artiste et l'album, que le chemin porte : `songs/<artiste>/<album>/<titre>`. Vide quand
 *  le chemin est plus court que cette forme — un morceau que personne n'a rangé. */
function under(path: string): string {
  const parts = path.split("/");
  return parts.length >= 4 ? `${parts[1]} · ${parts[2]}` : "";
}

export function QueueButton() {
  const { queue, removeFromQueue, moveInQueue } = usePlayback();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="relative shrink-0"
          aria-label={`Liste de lecture — ${queue.length} morceau${queue.length === 1 ? "" : "x"}`}
          title="Liste de lecture"
        >
          <ListVideo className="h-4 w-4" />
          {/* Le compte sur la pastille : c'est la seule chose qu'on veut savoir sans ouvrir,
              et une file vide n'en porte pas — un « 0 » serait du bruit permanent. */}
          {queue.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {queue.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      {/* Aligné à la fin et vers le haut : la barre est en bas de l'écran. */}
      <DropdownMenuContent align="end" side="top" className="w-96">
        <DropdownMenuLabel>
          À suivre{queue.length ? ` — ${queue.length}` : ""}
        </DropdownMenuLabel>

        {queue.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Rien à suivre. Clic droit sur un morceau dans l'arbre, « Ajouter à
            la liste de lecture ».
          </p>
        ) : (
          // Une liste et non des DropdownMenuItem : un item se ferme au clic, et déplacer une
          // ligne demande plusieurs clics d'affilée sur le même panneau.
          <ul className="max-h-80 overflow-auto">
            {queue.map((item, i) => (
              <li
                key={item.id}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50"
              >
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {item.entry.name}
                  </span>
                  {under(item.entry.path) && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {under(item.entry.path)}
                    </span>
                  )}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Monter"
                  disabled={i === 0}
                  onClick={() => moveInQueue(i, i - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Descendre"
                  disabled={i === queue.length - 1}
                  onClick={() => moveInQueue(i, i + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Retirer de la liste"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeFromQueue(i)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
