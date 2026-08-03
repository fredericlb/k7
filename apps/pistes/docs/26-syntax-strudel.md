# Strudel

## algo/<name>.strudel

A live Strudel (TidalCycles-in-JS) pattern. .label(...) names each lane; a strudel track receives the matching one. Played only when a track links this file.

```yaml exempt="Strudel source, not YAML — it has no schema to check."
stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
)
```
