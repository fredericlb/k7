// SessionFields.tsx — the forms of the main panel: the session header, a category's fields, a
// song's fields, and the save status in the bar. Split from Session.tsx, which keeps the columns
// and the picking. An empty value means "the key is not written" (docs/editing.md), which is
// why every select maps a sentinel back to the empty string: Radix refuses "" as an item value.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Checkbox } from "@frediverse/ui/checkbox";
import { Field } from "@frediverse/ui/field";
import { Loader2, Trash2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frediverse/ui/select";
import { Textarea } from "@frediverse/ui/textarea";
import { useId } from "react";
import { Tip } from "./controls";
import {
  type Category,
  EFFECT_KEYS,
  MODES,
  type Song,
  setCategoryField,
  setSessionField,
  setSongEffect,
  setSongField,
} from "./format";
import type { Store } from "./store";

/** The item value standing for "no value": the key is removed when it is picked. */
const NONE = "__none__";

function TextField({
  label: text,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={text}>
      <Input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** A closed list of values; one the file holds but the list lacks is shown rather than lost. */
function EnumSelect({
  value,
  options,
  none,
  onChange,
}: {
  value: string | undefined;
  options: readonly string[];
  none: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{none}</SelectItem>
        {value && !options.includes(value) && (
          <SelectItem value={value}>{value}</SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LiveOnly({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <label htmlFor={id}>Seulement en live</label>
    </div>
  );
}

export function SessionPanel({ store }: { store: Store }) {
  const s = store.session;
  if (!s) return null;
  const set = (k: string) => (v: string) =>
    store.editSession((doc) => setSessionField(doc, k, v));
  return (
    <div className="grid max-w-xl gap-3 p-4">
      <TextField label="Nom" value={s.name} onChange={set("name")} />
      <TextField
        label="Jeton d'URL publique"
        value={s.token}
        onChange={set("token")}
      />
      <TextField
        label="Mot de passe invité"
        value={s.password}
        onChange={set("password")}
        placeholder="aucun"
      />
      <TextField
        label="Consigne par défaut"
        value={s.notice}
        onChange={set("notice")}
      />
      {/* The password rides in the repository in clear, and changing it is a commit (../../docs/projects.md). */}
      <p className="text-xs text-muted-foreground">
        Le mot de passe voyage en clair avec la session : le changer est un
        commit.
      </p>
    </div>
  );
}

export function CategoryFields({
  store,
  cat,
  onDeleted,
}: {
  store: Store;
  cat: Category;
  onDeleted: () => void;
}) {
  const set =
    (k: string) =>
    (v: string | boolean): void =>
      store.editCategory(cat.slug, (doc) => setCategoryField(doc, k, v));
  return (
    <div className="border-b p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label="Nom affiché"
          value={cat.name}
          onChange={set("name")}
        />
        <Field label="Mode">
          <EnumSelect
            value={cat.mode}
            options={MODES}
            none="normal"
            onChange={set("mode")}
          />
        </Field>
        <TextField
          label="Variante jouée"
          value={cat.variant}
          onChange={set("variant")}
          placeholder="le master"
        />
        <TextField
          label="Consigne"
          value={cat.notice}
          onChange={set("notice")}
          placeholder="celle de la session"
        />
        <TextField
          label="Illustration"
          value={cat.illustration}
          onChange={set("illustration")}
        />
        <div className="self-end pb-2">
          <LiveOnly
            checked={cat.liveOnly ?? false}
            onChange={set("liveOnly")}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          categories/{cat.slug}.yaml
        </span>
        <Tip label="Le fichier part à la corbeille du service de fichiers ; les manches qui le nomment restent.">
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              void store.deleteCategory(cat.slug);
              onDeleted();
            }}
          >
            <Trash2 className="size-3.5" /> Supprimer la catégorie
          </Button>
        </Tip>
      </div>
    </div>
  );
}

export function SongFields({
  store,
  cat,
  song,
  songIndex,
}: {
  store: Store;
  cat: Category;
  song: Song;
  songIndex: number;
}) {
  const set =
    (k: string) =>
    (v: string | number | boolean | undefined): void =>
      store.editCategory(cat.slug, (doc) => setSongField(doc, songIndex, k, v));
  const effect = (k: string, v: number | undefined) =>
    store.editCategory(cat.slug, (doc) =>
      setSongEffect(doc, song, songIndex, k, v),
    );
  return (
    <div className="border-b p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label="Intitulé"
          value={song.label}
          onChange={set("label")}
          placeholder="l'artiste et le titre"
        />
        <Field label="État">
          <EnumSelect
            value={song.status}
            options={["valid", "to_replace"]}
            none="—"
            onChange={set("status")}
          />
        </Field>
        <Field label="Vitesse">
          <Input
            type="number"
            step="0.01"
            value={song.speed ?? ""}
            placeholder="1"
            onChange={(e) =>
              set("speed")(
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </Field>
      </div>

      {/* A textarea and not an input: `answer:` is a literal block, one accepted spelling per line. */}
      <Field label="Réponses acceptées — une par ligne" className="mt-3">
        <Textarea
          rows={song.answer?.includes("\n") ? 4 : 2}
          className="font-mono text-xs"
          value={song.answer ?? ""}
          placeholder="celle de la catégorie"
          onChange={(e) => set("answer")(e.target.value)}
        />
      </Field>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <LiveOnly checked={song.liveOnly ?? false} onChange={set("liveOnly")} />
        {/* A native disclosure: commons has no collapsible, and this one needs no state. */}
        <details className="w-full">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Traitements{" "}
            {song.effects ? `(${Object.keys(song.effects).length})` : ""}
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {EFFECT_KEYS.map((k) => (
              <Field key={k} label={k}>
                <Input
                  type="number"
                  step="1"
                  value={song.effects?.[k] ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    effect(
                      k,
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
              </Field>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

export function SaveBadge({ store }: { store: Store }) {
  const { saveStatus, saveError, hasUnsaved } = store;
  if (saveStatus === "saving")
    return (
      <Badge>
        <Loader2 className="size-3 animate-spin" /> Enregistrement…
      </Badge>
    );
  if (saveStatus === "error")
    return (
      <Tip label={saveError}>
        <Badge variant="rec" className="max-w-64 truncate">
          Non enregistré : {saveError}
        </Badge>
      </Tip>
    );
  if (hasUnsaved) return <Badge variant="amber">Modifié…</Badge>;
  if (saveStatus === "saved") return <Badge>Enregistré</Badge>;
  return null;
}
