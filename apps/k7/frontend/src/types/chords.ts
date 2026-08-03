// Shared shapes for the guitar chord database (@tombatossals/chords-db) and the
// react-chords renderer. A chord "position" is one fingering; a chord holds an
// array of positions — those are the alternative fingerings.

export interface ChordPosition {
  frets: number[];
  fingers: number[];
  baseFret: number;
  barres: number[];
  capo?: boolean;
  midi?: number[];
}

export interface ChordInstrument {
  strings: number;
  fretsOnChord: number;
  name?: string;
  keys?: string[];
  tunings: { standard: string[] };
}

export interface DbChord {
  key: string;
  suffix: string;
  positions: ChordPosition[];
}

export interface GuitarDb {
  main: {
    strings: number;
    fretsOnChord: number;
    name: string;
    numberOfChords: number;
  };
  tunings: { standard: string[] };
  keys: string[];
  suffixes: string[];
  chords: Record<string, DbChord[]>;
}
