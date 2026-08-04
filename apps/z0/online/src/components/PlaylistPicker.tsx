import { Avatar, AvatarFallback, AvatarImage } from "@frediverse/ui/avatar";
import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@frediverse/ui/card";
import { Input } from "@frediverse/ui/input";
import { ListMusic, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  addPlaylist,
  deletePlaylist,
  listPlaylists,
  type PlaylistRow,
} from "../lib/playlists";
import { m } from "../paraglide/messages.js";

// Playlist-mode picker: paste a public Deezer or Spotify link, or replay one
// somebody already saved. Saved rows are shared by everyone (like sessions);
// only the person who added one — or an admin — can remove it.

const PROVIDER_TAG_CLASS: Record<string, string> = {
  deezer: "border-[#a238ff]/50 text-[#c78bff]",
  spotify: "border-[#1db954]/50 text-[#4ade80]",
};

export function PlaylistPicker({
  activeId,
  selecting,
  onSelect,
}: {
  activeId: number;
  selecting: number;
  onSelect: (id: number) => void;
}) {
  const [rows, setRows] = useState<PlaylistRow[]>([]);
  const [spotifyOn, setSpotifyOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPlaylists();
      setRows(data.playlists);
      setSpotifyOn(data.spotify);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    const raw = url.trim();
    if (raw === "" || adding) return;
    setAdding(true);
    setError("");
    try {
      const row = await addPlaylist(raw);
      setUrl("");
      await refresh();
      onSelect(row.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: number) {
    setError("");
    try {
      await deletePlaylist(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["playlist.title"]()}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            type="text"
            autoComplete="off"
            placeholder={m["playlist.placeholder"]()}
            value={url}
            disabled={adding}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" disabled={adding || url.trim() === ""}>
            {adding && <Loader2 className="size-4 animate-spin" />}
            {adding ? m["playlist.adding"]() : m["playlist.add"]()}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {spotifyOn ? m["playlist.hint"]() : m["playlist.hintDeezerOnly"]()}
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {m["playlist.loading"]()}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {m["playlist.empty"]()}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((p) => (
              <div key={p.id} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  disabled={selecting !== 0}
                  onClick={() => onSelect(p.id)}
                  className={[
                    "flex min-w-0 flex-1 items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    p.id === activeId
                      ? "border-primary bg-secondary text-foreground"
                      : "border-border bg-card text-foreground hover:border-primary",
                  ].join(" ")}
                >
                  {selecting === p.id && (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  )}
                  <Avatar className="rounded-md">
                    {p.cover && <AvatarImage src={p.cover} alt="" />}
                    <AvatarFallback className="rounded-md bg-secondary">
                      <ListMusic className="size-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {p.name || p.url}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
                    <Badge
                      variant="tag"
                      className={PROVIDER_TAG_CLASS[p.provider]}
                    >
                      {p.provider}
                    </Badge>
                    <span className="text-muted-foreground">
                      {m["playlist.tracks"]({ n: p.trackCount })}
                    </span>
                    {p.score !== undefined && (
                      <span className="text-green tabular-nums">
                        {Math.round(p.score)}
                      </span>
                    )}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 hover:text-destructive"
                  title={m["playlist.remove"]()}
                  aria-label={m["playlist.remove"]()}
                  disabled={selecting !== 0}
                  onClick={() => void remove(p.id)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
