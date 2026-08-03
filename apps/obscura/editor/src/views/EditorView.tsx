import { useEffect, useRef, useState } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { LocaleSwitcher } from "../components/LocaleSwitcher";
import { LoginGate } from "../components/LoginGate";
import { useAuth } from "../lib/auth";
import { EditorAudio, useEditorAudioState } from "../lib/editorAudio";
import {
  type Category,
  EditorStore,
  EFFECT_KEYS,
  type EntityRef,
  type Song,
  type Track,
  useEditorStore,
} from "../lib/editorStore";
import { m } from "../paraglide/messages.js";

// React port of EditorView.vue's template. All state lives in EditorStore
// (data + selection + library modal) and EditorAudio (track preview); this
// component is the render layer plus the audio-loading glue that used to sit
// in the Vue setup block.

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export function EditorView() {
  const { status: authStatus, error: authError } = useAuth();
  const [store] = useState(() => new EditorStore());
  const [audio] = useState(() => new EditorAudio());
  useEditorStore(store);
  const audioState = useEditorAudioState(audio);

  // ─── Audio playback glue ────────────────────────────────────────────
  // Lazy: a track's audio doesn't load until the operator clicks Play. We
  // memoise resolved URLs by attachment id so re-selecting the same track
  // doesn't re-hit the backend (which itself only re-downloads on first
  // fetch — subsequent calls hit data/audio/grist/).
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [audioErrorMsg, setAudioErrorMsg] = useState("");
  const audioLoadedTrackId = useRef<EntityRef | null>(null);
  const audioURLByAttId = useRef(new Map<number, string>());

  useEffect(() => {
    void store.fetchSessions();
    return () => audio.dispose();
  }, [store, audio]);

  const selectedTrackId = store.selectedTrackId;
  // Stop & reset when the selected track changes — saves the operator from
  // hearing the previous track keep playing while they click around.
  useEffect(() => {
    audio.stop();
    if (selectedTrackId === null) {
      audioLoadedTrackId.current = null;
      setAudioStatus("idle");
    }
  }, [selectedTrackId, audio]);

  async function loadTrackAudio(track: Track): Promise<"ready" | "error"> {
    if (!track.audioRowId || track.audioRowId <= 0) {
      setAudioStatus("error");
      setAudioErrorMsg(m["editor.attrs.audioMissing"]());
      return "error";
    }
    setAudioStatus("loading");
    setAudioErrorMsg("");
    try {
      let url = audioURLByAttId.current.get(track.audioRowId);
      if (!url) {
        const r = await fetch(
          `/api/editor/attachments/${track.audioRowId}/url`,
          {
            credentials: "include",
          },
        );
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const data = (await r.json()) as { url: string };
        url = data.url;
        audioURLByAttId.current.set(track.audioRowId, url);
      }
      await audio.loadAudio(url);
      audioLoadedTrackId.current = track.id;
      setAudioStatus("ready");
      return "ready";
    } catch (e) {
      setAudioStatus("error");
      setAudioErrorMsg((e as Error).message);
      return "error";
    }
  }

  async function playTrackFull() {
    const tk = store.selectedTrack;
    if (!tk) return;
    let state: "ready" | "error" = audioStatus === "ready" ? "ready" : "error";
    if (audioLoadedTrackId.current !== tk.id) state = await loadTrackAudio(tk);
    if (state === "ready") audio.play(0);
  }

  async function playTrackRange() {
    const tk = store.selectedTrack;
    if (!tk) return;
    let state: "ready" | "error" = audioStatus === "ready" ? "ready" : "error";
    if (audioLoadedTrackId.current !== tk.id) state = await loadTrackAudio(tk);
    if (state !== "ready") return;
    const from = tk.start || 0;
    const to = tk.end && tk.end > from ? tk.end : undefined;
    audio.play(from, to);
  }

  function seekFromWaveform(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const time = ratio * audioState.duration;
    audio.seek(Math.max(0, Math.min(audioState.duration, time)));
  }

  function onAudioFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    const track = store.selectedTrack;
    if (!f || !track) return;
    void store.uploadAudioFile(track, f, () => {
      // Drop the cached URL for the previous attachment id so the next play
      // resolves the new one.
      audioURLByAttId.current.delete(track.audioRowId);
      audioLoadedTrackId.current = null;
    });
    e.target.value = ""; // allow re-uploading the same filename later
  }

  // ─── Auth gates ─────────────────────────────────────────────────────
  if (authStatus === "unauthenticated") return <LoginGate />;
  if (authStatus === "error")
    return <LoginGate message={authError || m["editor.authError"]()} />;

  const selectedCategory = store.selectedCategory;
  const selectedSong = store.selectedSong;
  const selectedTrack = store.selectedTrack;

  return (
    <div className="editor">
      <header className="topbar">
        <span className="title">▌ {m["editor.title"]()}</span>
        {store.loadedSessionId == null ? (
          <>
            <select
              className="picker"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) void store.loadSession(Number(v));
              }}
            >
              <option value="">{m["editor.pickSession"]()}</option>
              {store.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={store.saveStatus === "saving"}
              onClick={() => void store.createSession()}
            >
              {m["editor.createSession"]()}
            </button>
            {store.saveMessage && (
              <span className={`save-msg ${store.saveStatus}`}>
                {store.saveMessage}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="loaded">
              {m["editor.loadedSession"]({ id: store.loadedSessionId })}
            </span>
            <button className="btn" onClick={() => void store.changeSession()}>
              {m["editor.changeSession"]()}
            </button>
            <button
              className="btn"
              disabled={store.saveStatus === "saving"}
              onClick={() => void store.duplicateSession()}
            >
              {m["editor.duplicate"]()}
            </button>
            {/* Passive auto-save indicator (no manual Save button — edits
                flush ~1s after the operator stops typing). */}
            <span className={`save-msg ${store.saveStatus}`}>
              {store.saveStatus === "saving" && m["editor.autosave.saving"]()}
              {store.saveStatus === "saved" && store.saveMessage}
              {store.saveStatus === "error" &&
                `${m["editor.autosave.errorPrefix"]()} ${store.saveMessage}`}
            </span>
          </>
        )}
        <span className="spacer" />
        <span className="build">{VERSION}</span>
        <LocaleSwitcher />
        <AuthBadge />
      </header>

      {store.loadError && <div className="err">{store.loadError}</div>}

      {store.loadedSessionId != null && (
        <main className="layout">
          <aside className="left">
            <div className="section-title">
              {m["editor.pane.sessionLabel"]()}
            </div>
            <button
              className={`row${store.view === "session" ? " active" : ""}`}
              onClick={store.selectSession}
            >
              📁 {store.sessionName || "(unnamed)"}
            </button>

            <div className="section-title">
              {m["editor.pane.orderLabel"]({ n: store.order.length })}
            </div>
            {store.order.map((o, i) => (
              <div key={o.id} className="order-row">
                <button
                  className={`row flex${
                    store.view === "tree" &&
                    store.selectedCategoryId === o.categoryId
                      ? " active"
                      : ""
                  }`}
                  onClick={() =>
                    o.categoryId && store.selectCategory(o.categoryId)
                  }
                >
                  <span className="dim">#{i + 1}</span>
                  <span>{store.orderLabel(o)}</span>
                </button>
                <div className="row-actions">
                  <button
                    className="mini"
                    disabled={i === 0}
                    onClick={() => store.moveOrderEntry(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="mini"
                    disabled={i === store.order.length - 1}
                    onClick={() => store.moveOrderEntry(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="mini bad"
                    onClick={() => store.removeOrderEntry(i)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            <div className="add-row">
              <button
                className="btn small"
                onClick={store.addOrderCategoryFromLibrary}
              >
                {m["editor.pane.addCategoryFromLibrary"]()}
              </button>
              <button className="btn small" onClick={store.addOrderCategoryNew}>
                {m["editor.pane.addNewCategory"]()}
              </button>
              <button className="btn small" onClick={store.addOrderPause}>
                {m["editor.pane.addPause"]()}
              </button>
            </div>
          </aside>

          {store.view === "session" ? (
            /* SESSION attrs: full-width panel that replaces the tree view. */
            <section className="session-area">
              <div className="panel">
                <h3>{m["editor.attrs.sessionAttributes"]()}</h3>
                <label className="field">
                  <span>{m["editor.attrs.name"]()}</span>
                  <input
                    type="text"
                    value={store.sessionName}
                    onChange={(e) =>
                      store.mutate(() => (store.sessionName = e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  <span>{m["editor.attrs.guestPassword"]()}</span>
                  <input
                    type="text"
                    value={store.guestPassword}
                    onChange={(e) =>
                      store.mutate(() => (store.guestPassword = e.target.value))
                    }
                  />
                </label>
              </div>
            </section>
          ) : (
            /* TREE view: three persistent columns. Each column highlights the
               row whose selection feeds the next column. */
            <section className="tree-area">
              {/* ── CATEGORY column ─────────────────────────────────── */}
              <div className="tree-col">
                <div className="col-head">{m["editor.columns.category"]()}</div>
                {selectedCategory ? (
                  <CategoryPanel store={store} cat={selectedCategory} />
                ) : (
                  <div className="panel dim placeholder">
                    {m["editor.columns.pickCategory"]()}
                  </div>
                )}
              </div>

              {/* ── SONG column ─────────────────────────────────────── */}
              <div className="tree-col">
                <div className="col-head">{m["editor.columns.song"]()}</div>
                {selectedSong ? (
                  <SongPanel
                    store={store}
                    song={selectedSong}
                    hasCategory={!!selectedCategory}
                  />
                ) : (
                  <div className="panel dim placeholder">
                    {m["editor.columns.pickSong"]()}
                  </div>
                )}
              </div>

              {/* ── TRACK column ────────────────────────────────────── */}
              <div className="tree-col">
                <div className="col-head">{m["editor.columns.track"]()}</div>
                {selectedTrack ? (
                  <div className="panel">
                    <h3>
                      track {selectedTrack.id}{" "}
                      <span className="dim">
                        {selectedTrack.id.startsWith("new-")
                          ? m["editor.badges.new"]()
                          : ""}
                      </span>
                    </h3>
                    <label className="field">
                      <span>{m["editor.attrs.artist"]()}</span>
                      <input
                        type="text"
                        value={selectedTrack.artist}
                        onChange={(e) =>
                          store.mutate(
                            () => (selectedTrack.artist = e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.songTitle"]()}</span>
                      <input
                        type="text"
                        value={selectedTrack.title}
                        onChange={(e) =>
                          store.mutate(
                            () => (selectedTrack.title = e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.type"]()}</span>
                      <input
                        type="text"
                        placeholder={m["editor.attrs.typeHint"]()}
                        value={selectedTrack.type}
                        onChange={(e) =>
                          store.mutate(
                            () => (selectedTrack.type = e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.startSeconds"]()}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedTrack.start}
                        onChange={(e) =>
                          store.mutate(
                            () =>
                              (selectedTrack.start =
                                Number(e.target.value) || 0),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.endSeconds"]()}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedTrack.end}
                        onChange={(e) =>
                          store.mutate(
                            () =>
                              (selectedTrack.end = Number(e.target.value) || 0),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.youtubeId"]()}</span>
                      <input
                        type="text"
                        value={selectedTrack.youtubeId}
                        onChange={(e) =>
                          store.mutate(
                            () => (selectedTrack.youtubeId = e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{m["editor.attrs.audioAttachmentId"]()}</span>
                      <input
                        type="number"
                        value={selectedTrack.audioRowId}
                        onChange={(e) =>
                          store.mutate(() => {
                            const v = Number(e.target.value) || 0;
                            selectedTrack.audioRowId = v;
                            selectedTrack.hasAudio = v > 0;
                          })
                        }
                      />
                    </label>

                    <div className="field">
                      <span>{m["editor.attrs.audioUpload"]()}</span>
                      <div className="upload-row">
                        <label className="btn small upload-btn">
                          <input
                            type="file"
                            accept="audio/*"
                            disabled={store.uploadState === "uploading"}
                            onChange={onAudioFileSelected}
                          />
                          {store.uploadState === "uploading"
                            ? m["editor.attrs.audioUploading"]()
                            : m["editor.attrs.audioUpload"]()}
                        </label>
                        {store.uploadMessage && (
                          <span className={`upload-msg ${store.uploadState}`}>
                            {store.uploadMessage}
                          </span>
                        )}
                      </div>
                    </div>

                    {selectedTrack.audioRowId > 0 ? (
                      <div className="audio-block">
                        <div className="audio-controls">
                          <button
                            className="btn small"
                            disabled={audioStatus === "loading"}
                            onClick={() => void playTrackFull()}
                          >
                            {m["editor.attrs.audioPlay"]()}
                          </button>
                          <button
                            className="btn small"
                            disabled={
                              audioStatus === "loading" ||
                              !(selectedTrack.end > selectedTrack.start)
                            }
                            onClick={() => void playTrackRange()}
                          >
                            {m["editor.attrs.audioPlayRange"]()}
                          </button>
                          <button
                            className="btn small"
                            disabled={!audioState.isPlaying}
                            onClick={audio.stop}
                          >
                            {m["editor.attrs.audioStop"]()}
                          </button>
                          {audioStatus === "loading" && (
                            <span className="dim">
                              {m["editor.attrs.audioLoading"]()}
                            </span>
                          )}
                          {audioStatus === "error" && (
                            <span className="err inline">{audioErrorMsg}</span>
                          )}
                          {audioStatus === "ready" &&
                            audioState.duration > 0 && (
                              <span className="dim small">
                                {m["editor.attrs.audioCurrentTime"]({
                                  cur: audioState.currentTime.toFixed(1),
                                  dur: audioState.duration.toFixed(1),
                                })}
                              </span>
                            )}
                        </div>
                        {audioStatus === "ready" &&
                          audioState.waveformData.length > 0 && (
                            <div
                              className="waveform"
                              onClick={seekFromWaveform}
                            >
                              {audioState.waveformData.map((p, idx) => (
                                <div
                                  key={idx}
                                  className={`wave-bar${
                                    audioState.duration > 0 &&
                                    (idx / audioState.waveformData.length) *
                                      audioState.duration <
                                      audioState.currentTime
                                      ? " played"
                                      : ""
                                  }`}
                                  style={{ height: `${Math.max(2, p * 100)}%` }}
                                />
                              ))}
                              {(selectedTrack.start > 0 ||
                                selectedTrack.end > 0) && (
                                <div
                                  className="wave-range"
                                  style={{
                                    left: `${(selectedTrack.start / Math.max(audioState.duration, 0.001)) * 100}%`,
                                    width: `${Math.max(
                                      0,
                                      ((selectedTrack.end -
                                        selectedTrack.start) /
                                        Math.max(audioState.duration, 0.001)) *
                                        100,
                                    )}%`,
                                  }}
                                />
                              )}
                            </div>
                          )}
                      </div>
                    ) : (
                      <p className="dim small">
                        {m["editor.attrs.audioMissing"]()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="panel dim placeholder">
                    {m["editor.columns.pickTrack"]()}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      )}

      {/* Library modal */}
      {store.libraryOpen && (
        <div
          className="modal-bg"
          onClick={(e) => {
            if (e.target === e.currentTarget) store.closeLibrary();
          }}
        >
          <div className="modal">
            <header className="modal-head">
              <h3>{m["editor.library.title"]({ kind: store.libraryKind })}</h3>
              <input
                className="modal-search"
                type="text"
                placeholder={m["editor.library.filter"]()}
                value={store.libraryFilter}
                onChange={(e) => store.setLibraryFilter(e.target.value)}
              />
              <button className="mini bad" onClick={store.closeLibrary}>
                ×
              </button>
            </header>
            {store.libraryLoading ? (
              <div className="dim">{m["editor.library.loading"]()}</div>
            ) : (
              <ul className="modal-list">
                {store.filteredLibrary.map((row) => (
                  <li
                    key={row.id}
                    className="modal-row"
                    onClick={() => store.pickFromLibrary(row.id)}
                  >
                    <span className="dim">#{row.id}</span>
                    {store.libraryKind === "categories" ? (
                      <span>
                        {(row as Category).name}{" "}
                        <span className="dim">
                          [mode={(row as Category).mode || "·"}]
                        </span>
                      </span>
                    ) : store.libraryKind === "tracks" ? (
                      <span>
                        {(row as Track).artist || "—"} ·{" "}
                        {(row as Track).title || "—"}
                        {(row as Track).type && (
                          <span className="dim"> [{(row as Track).type}]</span>
                        )}
                      </span>
                    ) : (
                      <span>{store.songDisplay(row as Song)}</span>
                    )}
                  </li>
                ))}
                {store.filteredLibrary.length === 0 && (
                  <li className="dim">{m["editor.library.empty"]()}</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryPanel({ store, cat }: { store: EditorStore; cat: Category }) {
  return (
    <div className="panel">
      <h3>
        category {cat.id}{" "}
        <span className="dim">
          {cat.id.startsWith("new-") ? m["editor.badges.new"]() : ""}
        </span>
      </h3>
      <label className="field">
        <span>{m["editor.attrs.name"]()}</span>
        <input
          type="text"
          value={cat.name}
          onChange={(e) => store.mutate(() => (cat.name = e.target.value))}
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.mode"]()}</span>
        <input
          type="text"
          placeholder={m["editor.attrs.modeHint"]()}
          value={cat.mode}
          onChange={(e) => store.mutate(() => (cat.mode = e.target.value))}
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.notice"]()}</span>
        <textarea
          rows={2}
          value={cat.notice}
          onChange={(e) => store.mutate(() => (cat.notice = e.target.value))}
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.illustration"]()}</span>
        <input
          type="text"
          value={cat.illustration}
          onChange={(e) =>
            store.mutate(() => (cat.illustration = e.target.value))
          }
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.trackType"]()}</span>
        <input
          type="text"
          placeholder={m["editor.attrs.trackTypeHint"]()}
          value={cat.trackType}
          onChange={(e) => store.mutate(() => (cat.trackType = e.target.value))}
        />
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={cat.liveOnly}
          onChange={(e) =>
            store.mutate(() => (cat.liveOnly = e.target.checked))
          }
        />
        <span>{m["editor.attrs.liveOnly"]()}</span>
      </label>

      <h4>{m["editor.children.songsHeader"]({ n: cat.songIds.length })}</h4>
      <ul className="child-list">
        {cat.songIds.map((sid) => (
          <li
            key={sid}
            className={`child-row${store.selectedSongId === sid ? " feeds" : ""}`}
          >
            <button
              className={`row flex${store.selectedSongId === sid ? " feeds" : ""}`}
              onClick={() => store.selectSong(sid)}
            >
              <span className="feed-arrow" aria-hidden="true">
                ▶
              </span>
              <span className="dim">#{sid}</span>
              <span>
                {store.songById(sid)
                  ? store.songDisplay(store.songById(sid))
                  : m["editor.pane.missing"]({ id: sid })}
              </span>
              {store.songMissingExpectedTrackType(sid, cat) && (
                <span
                  className="warn-badge"
                  title={m["editor.children.songMissingTrackType"]({
                    type: cat.trackType || m["editor.children.plainTrack"](),
                  })}
                  aria-hidden="true"
                >
                  ⚠
                </span>
              )}
            </button>
            <button
              className="mini bad"
              onClick={() => store.removeSongFromCategory(cat, sid)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="add-row">
        <button
          className="btn small"
          onClick={() => store.addSongFromLibrary(cat)}
        >
          {m["editor.children.addSongFromLibrary"]()}
        </button>
        <button className="btn small" onClick={() => store.addSongNew(cat)}>
          {m["editor.children.addNewSong"]()}
        </button>
      </div>
    </div>
  );
}

function SongPanel({
  store,
  song,
  hasCategory,
}: {
  store: EditorStore;
  song: Song;
  hasCategory: boolean;
}) {
  return (
    <div className="panel">
      <h3>
        song {song.id}{" "}
        <span className="dim">
          {song.id.startsWith("new-") ? m["editor.badges.new"]() : ""}
        </span>
      </h3>
      {hasCategory && (
        <div className="add-row">
          <button className="btn small" onClick={store.createSongVariant}>
            {m["editor.children.createVariant"]()}
          </button>
        </div>
      )}
      <label className="field">
        <span>{m["editor.attrs.label"]()}</span>
        <input
          type="text"
          value={song.label}
          onChange={(e) => store.mutate(() => (song.label = e.target.value))}
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.answer"]()}</span>
        <input
          type="text"
          placeholder={m["editor.attrs.answerHint"]()}
          value={song.answer}
          onChange={(e) => store.mutate(() => (song.answer = e.target.value))}
        />
      </label>
      <label className="field">
        <span>{m["editor.attrs.status"]()}</span>
        <select
          value={song.status}
          onChange={(e) => store.mutate(() => (song.status = e.target.value))}
        >
          <option value="">{m["editor.attrs.statusUnverified"]()}</option>
          <option value="valid">{m["editor.attrs.statusValid"]()}</option>
          <option value="to_replace">
            {m["editor.attrs.statusToReplace"]()}
          </option>
        </select>
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={song.liveOnly}
          onChange={(e) =>
            store.mutate(() => (song.liveOnly = e.target.checked))
          }
        />
        <span>{m["editor.attrs.liveOnly"]()}</span>
      </label>

      <details>
        <summary>{m["editor.attrs.effects"]()}</summary>
        <div className="effects-grid">
          {EFFECT_KEYS.map((key) => (
            <label key={key} className="effect-cell">
              <span>{key}</span>
              <input
                type="number"
                value={song.effects[key] ?? 0}
                onChange={(e) =>
                  store.mutate(() => {
                    const v = Number(e.target.value) || 0;
                    if (v === 0) delete song.effects[key];
                    else song.effects[key] = v;
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>

      <h4>{m["editor.children.tracksHeader"]({ n: song.trackIds.length })}</h4>
      <ul className="child-list">
        {song.trackIds.map((tid) => (
          <li
            key={tid}
            className={`child-row${store.selectedTrackId === tid ? " feeds" : ""}`}
          >
            <button
              className={`row flex${store.selectedTrackId === tid ? " feeds" : ""}`}
              onClick={() => store.selectTrack(tid)}
            >
              <span className="feed-arrow" aria-hidden="true">
                ▶
              </span>
              <span className="dim">#{tid}</span>
              <span>
                {store.trackById(tid)?.artist} · {store.trackById(tid)?.title}
              </span>
              {store.trackById(tid)?.type && (
                <span className="dim">[{store.trackById(tid)?.type}]</span>
              )}
            </button>
            <button
              className="mini bad"
              onClick={() => store.removeTrackFromSong(song, tid)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="add-row">
        <button
          className="btn small"
          onClick={() => store.addTrackFromLibrary(song)}
        >
          {m["editor.children.addTrackFromLibrary"]()}
        </button>
        <button className="btn small" onClick={() => store.addTrackNew(song)}>
          {m["editor.children.addNewTrack"]()}
        </button>
      </div>
    </div>
  );
}
