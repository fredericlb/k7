# translator — importing from other DAWs

`packages/translator` reads a `.dawproject` and writes a pistes song folder: tracks, clips, warp maps, and a module per plugin — with two inserts of the same plugin becoming two instances of one module rather than two near-identical copies.

It is a library; `pistes import` is its caller.
