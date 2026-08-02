# Keeping the documentation honest

`src/docs/docs.test.ts` asks one question: does the documentation still describe the
software? There are two ways for it to stop, and both have happened.

## 1. An example goes stale

A field is renamed and the snippet keeps the old name. Caught by **parsing** every example
and validating it against the schema the loader itself uses. A doc example that would not
load is worse than no example: it is a recipe for a file the app rejects.

A fenced block declares which schema it must satisfy in its info string:

    ```yaml schema=Track

and one that cannot be validated says so instead, with a reason:

    ```yaml exempt="shows several files at once"

A plain ```` ```yaml ```` with neither **fails**, since silence is how an unchecked example
gets in.

## 2. A field is added and nobody writes it down

`libraries_from` was undocumented for as long as it existed, and was only noticed by a human
reading the page. Caught by walking each schema's own keys and asking whether any example
mentions them.

This check is deliberately weak — it looks for the key *anywhere* in an example of that
schema, not for correct usage — because its job is to fail when a field has no
documentation at all, which is the failure that actually occurs.

Both checks read the markdown under `lanes/docs/` — the documentation itself, not a copy
of it.
