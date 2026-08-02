import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frediverse/ui/tabs";
import { Clock, Loader2 } from "lucide-react";
import type { LoadProgress, SessionRow } from "obscura-shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthBadge } from "./components/AuthBadge";
import { LocaleSwitcher } from "./components/LocaleSwitcher";
import { LoginGate } from "./components/LoginGate";
import { PlaylistPicker } from "./components/PlaylistPicker";
import { SessionList } from "./components/SessionList";
import { type ScoringTarget, SoloGame } from "./components/SoloGame";
import { TokenGate } from "./components/TokenGate";
import {
  sessionNameToSlug,
  slugToSessionName,
  useRoute,
} from "./hooks/useRoute";
import { f } from "./lib/api";
import { refreshAuth, useAuth } from "./lib/auth";
import type { Session, SoloResume } from "./lib/game";
import { clearGuestStorage } from "./lib/guest";
import { PlaylistPlayer } from "./lib/playlistPlayer";
import { loadPlaylistTracks, sessionFromPlaylist } from "./lib/playlists";
import { m } from "./paraglide/messages.js";

// State machine (React port of App.vue): auth gate → session picker →
// SoloGame, with the token-aliased /t/<token> entry that keeps its URL for
// shareability and loads the session in place. Playlist mode (/p/<id>) feeds
// the same SoloGame a synthesized Session and a streaming player.

interface TokenResolved {
  id: number;
  name: string;
}

// Multi modes are UI-only for now — no backend flow exists yet, so picking
// either just shows a "coming soon" placeholder instead of a picker.
type GameMode = "solo" | "multi-buzzer" | "multi-no-buzzer";

// Playlist runs score against /api/playlists and keep no resume checkpoint —
// a 30s-clip run is short enough that there's nothing to come back to.
const PLAYLIST_SCORING: ScoringTarget = {
  base: "/api/playlists",
  progress: false,
  kind: "playlist",
};
const makePlaylistPlayer = () => new PlaylistPlayer();

export default function App() {
  const { status: authStatus, error: authError, user: authUser } = useAuth();
  const { path, navigate } = useRoute();

  // A real (non-guest) sign-in wipes the stored guest identity + history.
  useEffect(() => {
    if (authUser?.kind === "user") clearGuestStorage();
  }, [authUser?.kind]);

  const [gameMode, setGameMode] = useState<GameMode>("solo");

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [selecting, setSelecting] = useState(0);
  const progress: LoadProgress | null = null; // solo load endpoint is synchronous

  const [loadedSession, setLoadedSession] = useState<Session | null>(null);
  const [loadedSessionId, setLoadedSessionId] = useState(0);
  const [loadedResume, setLoadedResume] = useState<SoloResume | null>(null);
  const loadedIdRef = useRef(0);

  // Playlist mode runs alongside the session flow, never at the same time.
  const [playlistSession, setPlaylistSession] = useState<Session | null>(null);
  const [playlistId, setPlaylistId] = useState(0);
  const [playlistUnavailable, setPlaylistUnavailable] = useState(0);
  const [selectingPlaylist, setSelectingPlaylist] = useState(0);
  const loadedPlaylistRef = useRef(0);

  const refresh = useCallback(async () => {
    setPickerLoading(true);
    setPickerError("");
    try {
      const r = await f("/api/solo/sessions", { cache: "no-store" });
      if (!r.ok) {
        setPickerError(`${r.status} ${r.statusText}`);
        return;
      }
      const data = (await r.json()) as { sessions?: SessionRow[] };
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) {
      setPickerError((e as Error).message);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  const select = useCallback(async (id: number) => {
    if (loadedIdRef.current === id) return;
    setSelecting(id);
    setPickerError("");
    try {
      const r = await f(`/api/solo/sessions/${id}`, { cache: "no-store" });
      if (!r.ok) {
        const body = await r.text();
        setPickerError(`load failed: ${body || r.statusText}`);
        return;
      }
      const data = (await r.json()) as {
        id: number;
        session: Session;
        resume?: SoloResume;
      };
      loadedIdRef.current = id;
      setLoadedSession(data.session);
      setLoadedSessionId(data.id);
      setLoadedResume(data.resume ?? null);
    } catch (e) {
      setPickerError((e as Error).message);
    } finally {
      setSelecting(0);
    }
  }, []);

  const selectPlaylist = useCallback(async (id: number) => {
    if (loadedPlaylistRef.current === id) return;
    setSelectingPlaylist(id);
    setPickerError("");
    try {
      const data = await loadPlaylistTracks(id);
      loadedPlaylistRef.current = id;
      setPlaylistSession(sessionFromPlaylist(data));
      setPlaylistId(id);
      setPlaylistUnavailable(data.unavailable);
    } catch (e) {
      setPickerError((e as Error).message);
    } finally {
      setSelectingPlaylist(0);
    }
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated") void refresh();
  }, [authStatus, refresh]);

  // ── routing ────────────────────────────────────────────────────────────
  const routedSessionName = (() => {
    const m = path.match(/^\/s\/(.+)$/);
    return m ? slugToSessionName(m[1]) : null;
  })();
  const routedToken = (() => {
    const m = path.match(/^\/t\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  })();
  const routedPlaylistId = (() => {
    const m = path.match(/^\/p\/(\d+)$/);
    return m ? Number(m[1]) : 0;
  })();

  // /p/<id> ↔ loaded playlist reconciliation (the /s/<slug> twin below).
  useEffect(() => {
    if (routedPlaylistId === 0) {
      if (loadedPlaylistRef.current !== 0) {
        loadedPlaylistRef.current = 0;
        setPlaylistSession(null);
        setPlaylistId(0);
        setPlaylistUnavailable(0);
      }
      return;
    }
    if (authStatus !== "authenticated") return;
    if (loadedPlaylistRef.current === routedPlaylistId) return;
    void selectPlaylist(routedPlaylistId);
  }, [routedPlaylistId, authStatus, selectPlaylist]);

  const [tokenResolved, setTokenResolved] = useState<TokenResolved | null>(
    null,
  );
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [tokenResolving, setTokenResolving] = useState(false);

  // Resolve /t/<token>; clear on leaving the route.
  useEffect(() => {
    if (!routedToken) {
      setTokenResolved(null);
      setTokenInvalid(false);
      setTokenResolving(false);
      return;
    }
    let cancelled = false;
    setTokenResolving(true);
    setTokenInvalid(false);
    setTokenResolved(null);
    void (async () => {
      try {
        const r = await f(
          `/api/sessions/by-token/${encodeURIComponent(routedToken)}`,
          {
            credentials: "include",
          },
        );
        if (cancelled) return;
        if (!r.ok) {
          setTokenInvalid(true);
          return;
        }
        setTokenResolved((await r.json()) as TokenResolved);
      } catch {
        if (!cancelled) setTokenInvalid(true);
      } finally {
        if (!cancelled) setTokenResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routedToken]);

  // Token resolved + authenticated → load in place (URL stays /t/<token>).
  useEffect(() => {
    if (
      authStatus === "authenticated" &&
      tokenResolved &&
      loadedIdRef.current !== tokenResolved.id
    ) {
      void select(tokenResolved.id);
    }
  }, [authStatus, tokenResolved, select]);

  // URL ↔ loaded session reconciliation for the /s/<slug> flow.
  useEffect(() => {
    if (!routedSessionName) {
      // "/" clears the loaded session; /t/<token> keeps it (shareable URL).
      if (!routedToken && loadedIdRef.current !== 0) {
        loadedIdRef.current = 0;
        setLoadedSession(null);
        setLoadedSessionId(0);
        setLoadedResume(null);
      }
      return;
    }
    if (!sessions.length) return;
    const row = sessions.find((s) => s.name === routedSessionName);
    if (!row) {
      navigate("/", { replace: true });
      return;
    }
    if (loadedIdRef.current === row.id) return;
    void select(row.id);
  }, [routedSessionName, routedToken, sessions, navigate, select]);

  const onPickerSelect = (id: number) => {
    const row = sessions.find((s) => s.id === id);
    if (row) navigate(`/s/${sessionNameToSlug(row.name)}`);
  };

  // ── render ─────────────────────────────────────────────────────────────

  if (routedToken && !loadedSession) {
    if (tokenResolving) return <AuthLoading />;
    if (tokenInvalid) {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-sm">
            <CardContent className="flex flex-col items-stretch gap-3.5 py-4 text-center">
              <p className="text-sm text-destructive">
                {m["token.unknownToken"]()}
              </p>
              <Button variant="outline" asChild>
                <a href="/">{m["token.toPicker"]()}</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (authStatus !== "authenticated" && tokenResolved) {
      return (
        <TokenGate
          sessionName={tokenResolved.name}
          onClaimed={() => void refreshAuth()}
        />
      );
    }
    return <AuthLoading />;
  }

  if (authStatus === "unauthenticated") {
    return (
      <LoginGate title={m["auth.appTitle"]()} loginLabel={m["auth.login"]()} />
    );
  }
  if (authStatus === "error") {
    return (
      <LoginGate
        title={m["auth.appTitle"]()}
        message={authError || m["auth.authError"]()}
        loginLabel={m["auth.login"]()}
      />
    );
  }
  if (authStatus === "loading") return <AuthLoading />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-4 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold tracking-wide">
          {m["header.title"]()}
        </span>
        <span className="flex-1" />
        <LocaleSwitcher />
        {/* Logout hides mid-game — a stray tap would kick the player out. */}
        <AuthBadge
          logoutLabel={m["auth.logout"]()}
          showLogout={!loadedSession && !playlistSession}
        />
      </header>
      <main className="flex flex-1 justify-center px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex w-full max-w-xl flex-col gap-4">
          {playlistSession ? (
            <>
              {playlistUnavailable > 0 && (
                <Alert>
                  <AlertDescription className="col-start-1 text-amber">
                    {m["playlist.unavailable"]({ n: playlistUnavailable })}
                  </AlertDescription>
                </Alert>
              )}
              <SoloGame
                session={playlistSession}
                sessionId={playlistId}
                makePlayer={makePlaylistPlayer}
                scoring={PLAYLIST_SCORING}
                onExit={() => navigate("/")}
                onScored={() => {}}
              />
            </>
          ) : !loadedSession ? (
            <Tabs
              value={gameMode}
              onValueChange={(v) => setGameMode(v as GameMode)}
            >
              <TabsList>
                <TabsTrigger value="solo">{m["mode.solo"]()}</TabsTrigger>
                <TabsTrigger value="multi-buzzer">
                  {m["mode.multiBuzzer"]()}
                </TabsTrigger>
                <TabsTrigger value="multi-no-buzzer">
                  {m["mode.multiNoBuzzer"]()}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="solo" className="mt-4 flex flex-col gap-4">
                <SessionList
                  sessions={sessions}
                  activeId={loadedSessionId}
                  loading={pickerLoading}
                  error={pickerError}
                  selecting={selecting}
                  progress={progress}
                  title={m["picker.title"]()}
                  onSelect={onPickerSelect}
                  onRefresh={() => void refresh()}
                />
                <PlaylistPicker
                  activeId={playlistId}
                  selecting={selectingPlaylist}
                  onSelect={(id) => navigate(`/p/${id}`)}
                />
              </TabsContent>
              <TabsContent value="multi-buzzer" className="mt-4">
                <ModeComingSoon />
              </TabsContent>
              <TabsContent value="multi-no-buzzer" className="mt-4">
                <ModeComingSoon />
              </TabsContent>
            </Tabs>
          ) : (
            <SoloGame
              session={loadedSession}
              sessionId={loadedSessionId}
              resume={loadedResume}
              onExit={() => navigate("/")}
              onScored={() => void refresh()}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ModeComingSoon() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <Clock className="size-6" />
        <p className="text-sm">{m["mode.comingSoon"]()}</p>
      </CardContent>
    </Card>
  );
}
