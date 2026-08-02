export type GamePhase =
  | "loading"
  | "registration"
  | "scoreboard"
  | "category"
  | "mystery-question"
  | "song"
  | "answering"
  | "judging"
  | "reveal"
  | "pause"
  | "end";

export interface Track {
  artist?: string;
  title?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
  effects?: Record<string, number>;
}

export interface NextItem {
  type: string;
  category?: {
    name: string;
    illustration: string;
    mode?: string;
    notice?: string;
    songs?: {
      artist: string;
      title: string;
      path?: string;
      fullSong?: string;
      from?: number;
      to?: number;
      tracks?: Track[];
    }[];
  };
  song?: {
    artist: string;
    title: string;
    path?: string;
    label?: string;
    notice?: string;
    from?: number;
    to?: number;
    fullSong?: string;
    effects?: Record<string, number>;
    tracks?: Track[];
  };
  mode?: string;
  finished: boolean;
}

export interface Particle {
  x: number;
  y: number;
  speed: number;
}

export interface GlitchState {
  ox: number;
  oy: number;
  timer: number;
  active: boolean;
}

export interface CharFeatures {
  bodyColor: string;
  skinColor: string;
  eyeColor: string;
  hatType: number;
  hatColor: string;
}

export interface CharState {
  x: number;
  vx: number;
  legPhase: number;
  changeTimer: number;
  features: CharFeatures;
}
