// LicenseText.tsx — one licence or notice, as written: monospaced, wrapped, scrolled in place.

export function LicenseText({ text }: { text: string }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] text-neutral-400 leading-relaxed">
      {text}
    </pre>
  );
}
