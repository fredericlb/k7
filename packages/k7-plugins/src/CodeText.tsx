// CodeText.tsx — a translated sentence whose `backticked` spans are code. A message stays one
// sentence a translator can reorder, instead of fragments glued around <code> elements.

export function CodeText({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string.
        i % 2 === 1 ? <code key={i}>{part}</code> : part,
      )}
    </>
  );
}
