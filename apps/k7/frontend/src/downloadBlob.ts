// downloadBlob.ts — hand a blob to the person's disk under a name, the way a link with `download` does.
// The one thing a reader would get wrong: the object URL is revoked a second later, not at once — the click only queues the save.

/** Save `blob` to the user's disk under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
