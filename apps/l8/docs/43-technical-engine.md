# engine-protocol / engine-client — talking to the audio thread

`engine-protocol` is the wire vocabulary, shared by the Node client and the browser so the two cannot drift.

`engine-client` drives the engine from Node; the browser has its own small client (`@studio/engine-browser`) speaking the same protocol. Every web app here uses it — the editor, the media library and the decks — which is why it is a package rather than a file inside one of them.

What matters about this boundary: the engine's message thread is single-threaded and also runs plugin instantiation. Applying a project can block it for seconds, during which nothing — not the transport, not a meter — is answered. Anything the UI does per frame has to be cheap on that thread; anything expensive has to announce itself.
