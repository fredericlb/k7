// @tombatossals/react-chords ships no TypeScript types. Declare its Chord
// component against the shared shapes in ./chords. (The chords-db JSON is imported
// directly and cast to GuitarDb in chordDiagram.ts.)

declare module "@tombatossals/react-chords/lib/Chord" {
  import type { ComponentType } from "react";
  import type { ChordInstrument, ChordPosition } from "./chords";

  export interface ChordProps {
    chord: ChordPosition;
    instrument: ChordInstrument;
    lite?: boolean;
  }

  const Chord: ComponentType<ChordProps>;
  export default Chord;
}
