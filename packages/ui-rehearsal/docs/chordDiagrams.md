# Chord diagrams: one module touches the database

`src/utils/chordDiagram.ts` is the **only** module that touches
`@tombatossals/chords-db`, so the rest of the pages stays decoupled from its shape.

Two frictions with it:

- `resolveJsonModule` infers a huge literal type whose `chords` object has no string index
  signature; a cast to our own shape is what makes `chords[key]` typable.
- Its property names are not note names — sharps are camelCase, some flats are kept as written,
  and enharmonics are folded — hence the `ROOT_TO_DB` table.

Lookup tries the exact quality, then the slash form, then the bare triad, and answers `null`
when the chord is not in the database rather than inventing a fingering.

## The diagram renderer brings its own React, and must not

`@tombatossals/react-chords` declares `react` and `react-dom` as **dependencies** rather than
peers, and pins them to `^16`. Left alone, npm nests a second React under it, the `Chord`
component builds its elements with that copy, and the song page dies on render: *"A React
Element from an older version of React was rendered."* React 19 refuses an element minted by
React 16, so the failure is total rather than cosmetic, and it strikes only the one screen that
draws a diagram.

The root `package.json` therefore carries an `overrides` entry pinning that package's `react`
and `react-dom` to the version the apps use. The library itself is `React.createElement` over
SVG and needs nothing from React 16; only the resolution is wrong. `propTypes`, which it also
declares, is inert under React 19 and harmless.

## The médiathèque draws them too

The médiathèque's song page has a Diagrams tab, drawn by `SongAttachment` as the `diagrams` kind
(`packages/ui-library/docs/songPlayer.md`). The page hands it the chord list already transposed, so
the cards are this package's and the choice of chords stays the médiathèque's.
