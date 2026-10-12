// download.ts — a take saved to the device: the way out when an upload keeps failing, and the way back for one a crash left behind.

// The take saved to the device, named by its MIME type — the way out when the upload keeps failing.
export function downloadTake(blob: Blob) {
  const ext = blob.type.includes("mp4")
    ? "m4a"
    : blob.type.includes("ogg")
      ? "ogg"
      : "webm";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `take-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  a.click();
  // Revoked later rather than at once: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
