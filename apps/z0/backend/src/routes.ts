import { join } from "node:path";
import { memoryUpload } from "@frediverse/http/upload";
import express, { type Express } from "express";
import {
  handleAuthGuest,
  handleAuthLogout,
  handleAuthMe,
} from "./auth/handlers.ts";
import {
  handleAuthGuestOnline,
  handleGuestLookup,
  handleResolveSessionToken,
} from "./auth/onlineGuest.ts";
import {
  handleEditorAttachmentURL,
  handleEditorCreateSession,
  handleEditorDuplicateSession,
  handleEditorListLibrary,
  handleEditorListSessions,
  handleEditorLoadSession,
  handleEditorSaveSession,
  handleEditorUploadAttachment,
} from "./editor/handlers.ts";
import {
  getGameInfo,
  getPlayers,
  handleAddPlayer,
  handleBump,
  handleDoneRegistration,
  handleGameResume,
  handleListGames,
  handleNext,
  handleNextCategory,
  handlePeek,
  handleScore,
  handleScoreSet,
  handleSetRegistration,
  handleUnlockPlayer,
} from "./game/handlers.ts";
import { adminOnly } from "./middleware.ts";
import {
  handleAddPlaylist,
  handleDeletePlaylist,
  handleListPlaylists,
  handlePlaylistLeaderboard,
  handlePlaylistPreview,
  handlePlaylistScore,
  handlePlaylistTracks,
} from "./playlist/handlers.ts";
import {
  handleSoloLeaderboard,
  handleSoloListSessions,
  handleSoloLoadSession,
  handleSoloSaveProgress,
  handleSoloSaveScore,
} from "./solo/handlers.ts";
import {
  handleListGristSessions,
  handleSelectGristSession,
} from "./state/sessionControl.ts";
import { dataDir } from "./state.ts";

// Every route the Go server exposes (main.go's mux registrations), in the same
// order and with the same auth gates.
export function registerRoutes(app: Express): void {
  // Auth endpoints (always public — the middleware lets /auth/* through).
  // ALL of them are ours now: there is no /auth/login or /auth/callback here
  // any more, because the account login is st0's (docs/auth.md). What is left
  // is the guest flows, plus /me and /logout — and /logout expires only
  // bt_session, since z0 does not sign studio.sid.
  app.post("/auth/logout", handleAuthLogout);
  app.get("/auth/me", handleAuthMe);
  app.post("/auth/guest", handleAuthGuest);
  // Online-guest entry flow (paired with /t/<token> on the SPA) — all public.
  app.post("/auth/guest-online", handleAuthGuestOnline);
  app.get("/auth/guest-lookup", handleGuestLookup);
  app.get("/sessions/by-token/:token", handleResolveSessionToken);

  app.get("/hello", (_req, res) => {
    res.json({ message: "Hello from Node backend!" });
  });
  app.get("/api/data", (_req, res) => {
    res.json({ users: ["Alice", "Bob", "Charlie"], count: 3 });
  });

  // Live game.
  app.post("/bump", adminOnly(handleBump));
  app.post("/score", adminOnly(handleScore));
  app.post("/score/set", adminOnly(handleScoreSet));
  app.get("/players", getPlayers);
  app.post("/players/add", handleAddPlayer);
  app.post("/players/done", adminOnly(handleDoneRegistration));
  app.post("/players/unlock", adminOnly(handleUnlockPlayer));
  app.post("/registration", adminOnly(handleSetRegistration));
  app.get("/sessions", adminOnly(handleListGristSessions));
  app.post("/sessions/select", adminOnly(handleSelectGristSession));

  // Solo mode: any authenticated user — the global authMiddleware is the only
  // gate, matching the Go server.
  app.get("/solo/sessions", handleSoloListSessions);
  app.get("/solo/sessions/:id", handleSoloLoadSession);
  app.post("/solo/sessions/:id/score", handleSoloSaveScore);
  app.post("/solo/sessions/:id/progress", handleSoloSaveProgress);
  app.get("/solo/sessions/:id/leaderboard", handleSoloLeaderboard);

  // Playlist mode: same gate as solo (any authenticated user). The preview
  // redirect is the exception — it's public, because <audio> elements fetch
  // without credentials, and it leaks nothing beyond a public Deezer URL.
  app.get("/playlists/preview/:deezerId", handlePlaylistPreview);
  app.get("/playlists", handleListPlaylists);
  app.post("/playlists", handleAddPlaylist);
  app.delete("/playlists/:id", handleDeletePlaylist);
  app.get("/playlists/:id/tracks", handlePlaylistTracks);
  app.post("/playlists/:id/score", handlePlaylistScore);
  app.get("/playlists/:id/leaderboard", handlePlaylistLeaderboard);

  app.get("/game", getGameInfo);
  app.get("/games", handleListGames);
  app.post("/games/:id/resume", adminOnly(handleGameResume));
  app.post("/next", adminOnly(handleNext));
  app.post("/next-category", adminOnly(handleNextCategory));
  app.get("/peek", adminOnly(handlePeek));

  // Grist-backed editor, admin-only. The attachment upload takes a multipart
  // body ("file" field, 32 MiB ceiling) parsed by multer into req.file.
  const upload = memoryUpload(32 << 20);
  app.get("/editor/sessions", adminOnly(handleEditorListSessions));
  app.post("/editor/sessions", adminOnly(handleEditorCreateSession));
  app.get("/editor/sessions/:id", adminOnly(handleEditorLoadSession));
  app.post("/editor/sessions/:id", adminOnly(handleEditorSaveSession));
  app.post(
    "/editor/sessions/:id/duplicate",
    adminOnly(handleEditorDuplicateSession),
  );
  app.get("/editor/library/:kind", adminOnly(handleEditorListLibrary));
  app.get("/editor/attachments/:id/url", adminOnly(handleEditorAttachmentURL));
  app.post(
    "/editor/attachments",
    upload.single("file"),
    adminOnly(handleEditorUploadAttachment),
  );

  // Cached audio files — public by design (the buzzer/web SPAs stream without
  // credentials), streamed straight off the audio cache dir.
  app.use("/audio", express.static(join(dataDir(), "audio")));
}
