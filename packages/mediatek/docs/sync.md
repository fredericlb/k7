# Syncing a cache — extended notes

## Two sides, one library

The hosted service owns the library. `~/.studio/mediatek` on a musician's machine is a
**cache** of it, and it exists because the moteur plays from file paths: it cannot open a
URL, so the bytes have to land on disk whatever the catalogue says.

Both sides are the same shape — a folder — which is why `@studio/mediatek` runs on both
unchanged. The server scans its volume, the cache scans itself, same `scanFamily`, same
`familyRevision`.

## Why the manifest is REMEMBERED, not recomputed

This is the one thing that is easy to get wrong.

A downloaded file has its own mtime — the moment it was written locally, not the moment
the owner last touched it. So comparing a fresh local `stat` against the server's manifest
reports **every file as changed, every time**, and the cache re-downloads the whole library
on every poll.

So `diff(have, want)` takes **two descriptions by the owner**: `want` is what the server
says now, `have` is what the server said when those bytes were fetched, stored beside them.
Local timestamps never enter the comparison.

Concretely, a cache must persist the manifest it last accepted. Losing that file is not
corruption — it just means the next sync re-fetches everything, which is correct if slow.

## Why not the revision token

`familyRevision()` is `mutations:count:mtime`, and it answers "did this family change".
That is the right question for a POLL, and it is what the cache should ask first: cheap on
the server, and it stops the conversation when nothing moved.

It is the wrong question for "what do I fetch", for the same reason as above — the two
sides' tokens are computed over different mtimes and would never agree. The token gates the
sync; the manifest drives it.

## What the manifest does not carry

No content hash. Reading every file to decide whether to read every file costs more than
the thing it guards — the same trade `workspace.ts` makes, written down in index.md.

Size plus the owner's mtime misses a file replaced in place, same second, same length. On a
library whose writes go through one service that bumps a mutation counter, that is a gap the
poll closes rather than the manifest.

## `scope` narrows BOTH sides of the diff

`syncFamily` takes a `scope` predicate, for a cache that holds what its songs reach for rather
than the whole catalogue. It is applied to `want` **and** to `have`, and that is the part that
has to be right: scoping `want` alone would make every file outside the scope look like one the
owner had dropped, and the first partial sync would delete the rest of the library. Everything
out of scope keeps its remembered entry untouched.

Two other properties of a sync, for the same reason `download()` uses `.part`: files land under
a temporary name and are renamed into place, so an interrupted sync leaves whole files rather
than truncated ones — the moteur may be reading this tree. And the remembered manifest is
written **last**, reflecting only what actually landed: a crash mid-sync means the next one
re-fetches, which is the safe direction. `markSynced` is only called for a sync that failed
nothing, so a partial sync stays stale and the missing files are retried.

## Eviction lives next door

`diff()` returns `drop` — what the cache holds and the owner **no longer has**. That is a
different question from "what can this disk afford", which `docs/eviction.md` answers: a
per-family byte budget, least-recently-fetched first, `modules` never evicted, and nothing
automatic.

One thing from that page belongs here too, because it is really a fact about *this* one:
eviction has to rewrite the remembered manifest. Deleting bytes without forgetting them
leaves a cache that believes it still holds a file for ever — `diff()` compares against the
memory, not the disk, which is the whole point of the section above.

## Un téléchargement passe par `.part`

`download()` écrit sous `<dest>.part` et renomme à la fin. La destination, c'est le cache
médiathèque de la machine — exactement les fichiers que les platines ouvrent et que le moteur
décode — et un master tronqué qui s'y installe est pire qu'un master absent : rien ne dit
qu'il est court, il se joue jusqu'à ce qu'il s'arrête. Le renommage est atomique sur un même
système de fichiers, donc ce qui apparaît sous le vrai nom est toujours arrivé entier ; un
échec ne laisse rien du tout.

## `terminated` ne dit rien, et c'est le format qui est en cause

`fetch` rapporte une panne de transport en deux mots — `fetch failed` ou `terminated` — et
range la vraie raison dans `cause`. Un appel qui se contente de `e.message` remonte donc un
mot qui peut désigner six choses — « analyse impossible : terminated », dans un navigateur, à
propos d'un téléchargement entre deux serveurs.

`why()` aplatit la chaîne des `cause` dans le message, parce que le message est le seul champ
qui survit au trajet retour à travers HTTP jusqu'à un navigateur. On lit :

```
mediatek GET https://st0.priv.frediver.se/api/mediatek/file songs/…/original.flac:
  terminated ← other side closed (UND_ERR_SOCKET)
```

L'adresse en fait partie délibérément : `MEDIATEK_URL` est **déduite** et non configurée
(voir `mediatekUrlFor` dans `@studio/engine-host`), donc « quelle médiathèque a-t-elle
seulement essayée » est la moitié de la réponse chaque fois que la réponse est « la mauvaise ».

Ce que disent les causes les plus courantes :

| cause | ce qui s'est passé |
|---|---|
| `other side closed (UND_ERR_SOCKET)` | l'hôte a fermé avant la fin du corps annoncé — souvent un service redémarré en plein téléchargement, ce qu'un `tilt` fait à chaque sauvegarde |
| `unable to verify the first certificate` | une autorité que node ne connaît pas — un proxy local à CA privée devant le service |
| `ECONNREFUSED` | personne n'écoute à cette adresse |
| `UND_ERR_BODY_TIMEOUT` | le corps a cessé d'arriver sans que la connexion tombe |

Il n'y a **pas** de réessai : un téléchargement de master est long, et réessayer en silence
transformerait une cause visible en une attente deux fois plus longue. Le `.part` rend
pourtant un réessai sûr, si l'usage le demande un jour.
