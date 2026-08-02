import { usePreloaderState } from "@studio/player-web/preloader";
import { useEffect, useMemo, useState } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { f } from "../lib/api";
import { useAudioUIState } from "../lib/audioPlayback";
import { useMicState } from "../lib/mic";
import { useMonitorState } from "../lib/monitor";
import { createMonitorSystem } from "../lib/system";
import { useVirtualBuzzersState } from "../lib/virtualBuzzers";

// React port of monitor-web's App.vue main screen. Only mounted once the
// auth gate has passed (authenticated admin), which is when the Vue version
// called startMonitor().

function timeNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function medal(i: number): string {
  if (i === 0) return "①";
  if (i === 1) return "②";
  if (i === 2) return "③";
  return " ";
}

export function MonitorView() {
  const [sys] = useState(createMonitorSystem);
  const mon = useMonitorState(sys.monitor);
  const audioUI = useAudioUIState(sys.audio);
  const pre = usePreloaderState(sys.audio.preloader);
  const mic = useMicState(sys.mic);
  const { buzzers } = useVirtualBuzzersState(sys.virtual);

  const [newBuzzerName, setNewBuzzerName] = useState("");
  const [createError, setCreateError] = useState("");
  const [needsGesture, setNeedsGesture] = useState(true);
  const [clock, setClock] = useState(timeNow);

  useEffect(() => {
    sys.start();
    const clockInterval = window.setInterval(() => setClock(timeNow()), 1000);
    return () => {
      window.clearInterval(clockInterval);
      sys.stop();
    };
  }, [sys]);

  const rankedPlayers = useMemo(
    () => [...mon.players].sort((a, b) => b.score - a.score),
    [mon.players],
  );

  async function dismissGesture() {
    sys.audio.preloader.resumeContext();
    setNeedsGesture(false);
    try {
      const r = await f("/api/game", { cache: "no-store" });
      if (!r.ok) return;
      const info = await r.json();
      if (info.phase === "song" && info.currentItem) {
        await sys.audio.recover(info.currentItem, info.categorySongs);
      }
    } catch (e) {
      console.error("recover failed:", e);
    }
  }

  function createVirtualBuzzer(e: React.FormEvent) {
    e.preventDefault();
    const err = sys.virtual.create(newBuzzerName);
    if (err) {
      setCreateError(err);
      return;
    }
    setCreateError("");
    setNewBuzzerName("");
  }

  return (
    <>
      {needsGesture && (
        <div
          className="gesture-overlay"
          onClick={() => void dismissGesture()}
          onTouchStart={(e) => {
            e.preventDefault();
            void dismissGesture();
          }}
        >
          <div className="gesture-text">CLICK TO ENABLE AUDIO</div>
        </div>
      )}
      <div className="screen">
        <header className="topbar">
          <span className="title">▌ BLIND-TEST MONITOR</span>
          <span className={`conn${mon.connected ? " ok" : ""}`}>
            ● {mon.connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
          <span className="url">{mon.wsURL || "—"}</span>
          <span className="spacer" />
          <AuthBadge />
          <span className="clock">{clock}</span>
        </header>

        <main className="grid">
          <section className="panel ws-panel">
            <header className="panel-title">┤ WEBSOCKET TRAFFIC ├</header>
            <div className="panel-body ws-body">
              {mon.wsEntries.length === 0 && (
                <div className="dim">waiting for messages…</div>
              )}
              {mon.wsEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`ws-row${entry.direction === "info" ? " info" : ""}`}
                >
                  <span className="ts">{entry.ts}</span>
                  <span className="type">{entry.type.padEnd(16, " ")}</span>
                  <span className="payload">{entry.payload}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="side">
            <section className="panel">
              <header className="panel-title">┤ PHASE ├</header>
              <div className="panel-body phase-body">
                {mon.phase ? mon.phase.toUpperCase() : "—"}
              </div>
            </section>

            <section className="panel">
              <header className="panel-title">┤ CURRENT SONG ├</header>
              <div className="panel-body song-body">{mon.song || "—"}</div>
            </section>

            <section className="panel">
              <header className="panel-title">┤ AUDIO ├</header>
              <div className="panel-body audio-body">
                <div className="audio-row">
                  <span className="audio-label">PLAYING</span>
                  <span className="audio-val">
                    {pre.isPlaying
                      ? pre.isPaused
                        ? "⏸ paused"
                        : "▶ playing"
                      : "· idle"}
                  </span>
                </div>
                <div className="audio-row">
                  <span className="audio-label">MODE</span>
                  <span className="audio-val">
                    {audioUI.currentMode || "—"}
                  </span>
                </div>
                <div className="audio-row">
                  <span className="audio-label">VOL</span>
                  <input
                    className="audio-vol"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(audioUI.masterGain * 100)}
                    onChange={(e) =>
                      sys.audio.setVolume(Number(e.target.value) / 100)
                    }
                  />
                  <span className="audio-val">
                    {Math.round(audioUI.masterGain * 100)}%
                  </span>
                  <button
                    className="audio-btn"
                    onClick={() => sys.audio.toggleMute()}
                  >
                    {audioUI.muted ? "UNMUTE" : "MUTE"}
                  </button>
                </div>
                {pre.loading && (
                  <div className="audio-row">
                    <span className="audio-label">LOADING</span>
                    <div className="progress-bar-outer">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${Math.round(pre.progress * 100)}%` }}
                      />
                    </div>
                    <span className="audio-val">
                      {pre.loaded}/{pre.total}
                    </span>
                  </div>
                )}
                {pre.failedPaths.length > 0 && (
                  <div className="audio-row">
                    <span className="audio-label">FAILED</span>
                    <span className="audio-val warn">
                      {pre.failedPaths.length} path(s)
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <header className="panel-title">┤ MIC ├</header>
              <div className="panel-body audio-body">
                <div className="audio-row">
                  <span className="audio-label">STATE</span>
                  <span className="audio-val">
                    {mic.enabled ? "● live" : "· off"}
                  </span>
                  <button
                    className="audio-btn"
                    onClick={() => void sys.mic.toggle()}
                  >
                    {mic.enabled ? "DISABLE" : "ENABLE"}
                  </button>
                </div>
                <div className="audio-row">
                  <span className="audio-label">GAIN</span>
                  <input
                    className="audio-vol"
                    type="range"
                    min={0}
                    max={200}
                    value={mic.gainPct}
                    onChange={(e) =>
                      sys.mic.onGainInput(Number(e.target.value))
                    }
                  />
                  <span className="audio-val">{mic.gainPct}%</span>
                </div>
                {mic.error && (
                  <div className="audio-row">
                    <span className="audio-label">ERROR</span>
                    <span className="audio-val warn">{mic.error}</span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <header className="panel-title">┤ VIRTUAL BUZZERS ├</header>
              <div className="panel-body audio-body">
                <form
                  className="audio-row vb-form"
                  onSubmit={createVirtualBuzzer}
                >
                  <input
                    className="vb-input"
                    type="text"
                    maxLength={12}
                    placeholder="player name"
                    autoComplete="off"
                    value={newBuzzerName}
                    onChange={(e) => setNewBuzzerName(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="audio-btn"
                    disabled={!newBuzzerName.trim()}
                  >
                    CREATE
                  </button>
                </form>
                {createError && (
                  <div className="audio-row">
                    <span className="audio-val warn">{createError}</span>
                  </div>
                )}
                {buzzers.length === 0 && (
                  <div className="audio-row">
                    <span className="audio-val dim">no virtual buzzers</span>
                  </div>
                )}
                {buzzers.map((b) => (
                  <div key={b.token} className="audio-row vb-row">
                    <span
                      className={`vb-led${b.connected && b.registered ? " on" : ""}`}
                    >
                      ●
                    </span>
                    <span className="vb-name">{b.name}</span>
                    <span className="vb-id">{b.deviceId || "—"}</span>
                    {b.connected && !b.registered ? (
                      <button
                        className="audio-btn vb-buzz"
                        onClick={() => sys.virtual.join(b.name)}
                      >
                        JOIN
                      </button>
                    ) : (
                      <button
                        className="audio-btn vb-buzz"
                        disabled={!b.connected || !b.registered}
                        onClick={() => sys.virtual.buzz(b.name)}
                      >
                        BUZZ
                      </button>
                    )}
                    <button
                      className="audio-btn"
                      onClick={() => sys.virtual.remove(b.name)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel grow">
              <header className="panel-title">
                ┤ PLAYERS ({rankedPlayers.length}) ├
              </header>
              <div className="panel-body players-body">
                {rankedPlayers.length === 0 && (
                  <div className="dim">no players yet</div>
                )}
                {rankedPlayers.map((p, i) => (
                  <div
                    key={p.name}
                    className={`player-row${i < 3 ? " top" : ""}${
                      mon.buzzing.has(p.name) ? " buzzing" : ""
                    }`}
                  >
                    <span className="rank">
                      {String(i + 1).padStart(2, " ")}
                    </span>
                    <span className="medal">{medal(i)}</span>
                    <span className="name">{p.name}</span>
                    <span className="score">{Math.round(p.score)}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </main>
      </div>
    </>
  );
}
