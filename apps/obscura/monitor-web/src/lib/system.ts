import { AudioPlayback } from "./audioPlayback";
import { GameState } from "./gameState";
import { Mic } from "./mic";
import { MonitorClient } from "./monitor";
import { VirtualBuzzers } from "./virtualBuzzers";

// Wires the monitor modules together the same way App.vue's setup did.
// start()/stop() are reversible (React StrictMode double-mounts effects in
// dev): stop closes sockets, timers and the mic but keeps the internal WS
// subscriptions alive so a re-start picks up where it left off.

export interface MonitorSystem {
  monitor: MonitorClient;
  audio: AudioPlayback;
  gameState: GameState;
  mic: Mic;
  virtual: VirtualBuzzers;
  start: () => void;
  stop: () => void;
}

export function createMonitorSystem(): MonitorSystem {
  const monitor = new MonitorClient();
  const audio = new AudioPlayback({
    subscribe: monitor.subscribe,
    sendWS: monitor.sendWS,
  });
  const mic = new Mic({
    subscribe: monitor.subscribe,
    sendWS: monitor.sendWS,
    setDuck: (v) => audio.preloader.setDuck(v),
  });
  const gameState = new GameState({
    subscribe: monitor.subscribe,
    sendWS: monitor.sendWS,
    getPlayers: () => monitor.getState().players,
    audio,
  });
  const virtual = new VirtualBuzzers();

  return {
    monitor,
    audio,
    gameState,
    mic,
    virtual,
    start() {
      monitor.start();
      virtual.start();
    },
    stop() {
      monitor.stop();
      virtual.dispose();
      mic.disable();
      audio.clearFusionTimers();
      audio.preloader.stop();
    },
  };
}
