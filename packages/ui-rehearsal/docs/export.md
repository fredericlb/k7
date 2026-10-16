# Exporting the songbook

Two entries of the songbook's ⋮ menu, at the right end of the table's header, one per format.
Each makes **one file per song** of the
user's **favourites**, puts them all in a zip and hands that to the browser. The songbook is
shared by everyone ([ownership.md](../../rehearsal-server/docs/ownership.md)); the favourites are what one person carries. The zip is the deliverable because a songbook is
read one song at a time: a single 200-page file is not what you carry to a rehearsal.

## It runs in the browser

`GET /api/songs` answers with rows and no texts ([store.md](../../rehearsal-server/docs/store.md)),
so each favourite is fetched whole from its own `GET /api/songs/:sid` as its turn comes. A server
route would hold every generated file in memory at once and put two more dependencies in the
hosted image for a job that needs no server-side half.

Both generators are behind `import()`. They are the two heaviest dependencies of these pages —
pdf-lib ~420 kB, epub-gen-memory ~220 kB — and neither belongs in the chunk that draws a
session list.

Songs are built **one at a time**. Sheet scans are megabytes; building in parallel would hold
every one of them at once, and it is also what lets the line under the menu count off `3/12` truthfully.

## PDF: pdf-lib, and the two things it costs

`pdf-lib` is the choice the studio already made in phare (`apps/calepin`), which is reason
enough to make it again here — and it is the only one of the candidates that can **open** a
PDF, without which a song's own sheet music could not be appended to its export.

It bills for that in two places:

- **The standard fonts encode WinAnsi and nothing else**, and pdf-lib throws on the first glyph
  outside it, which would lose the whole export over one character. So text is transliterated
  first: `♭` and `♯` are spelled `b` and `#` — they are the two a songbook actually carries —
  and everything else outside the repertoire becomes `?`. Embedding a Unicode font instead
  would add ~300 kB to a download that is already the pages' largest.
- **It lays out no text.** That suits this document: a chord grid is column art, so the body is
  Courier and the wrap counts characters rather than measuring them.

**Every page is A4, including a sheet image**, which is scaled to fit inside the margins rather
than given a page its own size. A songbook is printed and bound; pages that each match their
scan cannot be. (phare's `imagesToPdf` chooses the opposite for the opposite reason — there the
PDF *is* the images.) PDF sheets are merged in at their own size, since they arrive paginated.

## EPUB: epub-gen-memory, and what a reader will not take

The format is a zip of XHTML with a manifest, a spine and a nav document, and none of that is
worth hand-rolling. `epub-gen-memory` takes a title, an author and HTML chapters, and returns a
blob in the browser.

The chapters are `<pre>`. Everything an EPUB reader does by default — reflow, hyphenate,
re-justify — destroys a chord sheet, where the only thing holding a chord over its syllable is
the column it sits in.

**The images are fetched by the library**, from the URLs in the chapter markup, and it reads
each one's media type off the URL's **extension**. That is why `/api/songs/:sid/sheets/:fid`
answers under a second, name-bearing address as well: the bare one ends in a uuid, which names
no format. A plain download gets a real filename out of the same route.

**A PDF sheet is not in the EPUB.** There is no page an EPUB can make of one. Images are, and
anything the browser can display but pdf-lib cannot embed — GIF, WebP, SVG — is redrawn as JPEG
on the way into the PDF.

**A score sheet is in neither.** A MusicXML or Guitar Pro file is notation, not a page, and
drawing one to paper is a job this export does not take on — so it is not even downloaded
([score.md](../../score/docs/score.md)).

## What a failure costs

A song that throws is named in the line under the menu, and the zip ships with every other
one in it. A sheet that will not load costs itself and is counted, not the song. An export that
loses one file silently would be worse than one that loses it loudly, and an export that
refuses to produce anything because song 40 of 60 is broken is worst of all.
