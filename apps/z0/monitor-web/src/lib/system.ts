import { AudioPlayback } from "./audioPlayback";
import { GameState } from "./gameState";
import { Mic } from "./mic";
import { MonitorClient } from "./monitor";
import { VirtualBuzzers } from "./virtualBuzzers";

// start()/stop() are reversible for StrictMode: stop keeps the WS subscriptions a restart needs.

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
