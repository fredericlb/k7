# translator — importing from other DAWs

`packages/translator` reads another DAW's project and writes a l8 song folder: tracks, clips, warp maps, and a module per plugin — with two inserts of the same plugin becoming two instances of one module rather than two near-identical copies.

Two formats are read today: **`.dawproject`** (the open exchange format Bitwig, Studio One and Cubase write) and **`.als`** (Ableton Live 11 and 12). Click either one in the file tree and l8 offers to import it as a new project in the workspace.

An import is deliberately lossy where a format has something l8 cannot represent, and the popin shows the log so you see what did not come across — clips it could not place, plugins with no match, and for Live, its own devices, sends, Session view clips and rack structure.

One thing to know before importing a Live set: **run File ▸ Collect All and Save in Live first**. A `.als` only points at its samples, and l8 will not follow a path that leaves the workspace, so an uncollected set imports its whole arrangement without any audio. The import log says so when it happens.

It is a library; the file service is its caller.
