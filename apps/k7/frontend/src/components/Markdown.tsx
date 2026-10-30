// Markdown.tsx — render a documentation page with `marked` (tables, nested lists and
// fenced info strings are more than a hand-rolled parser should be asked to get right).
// dangerouslySetInnerHTML is safe HERE and only here: the input is our own .md files,
// bundled at build time, with no path by which anything user-controlled reaches it.
// Do not point this component at anything fetched. `marked` is fetched the first time a page renders.

import { useEffect, useState } from "react";

type Parse = (body: string) => string;
let parse: Parse | null = null;
const loadParse = (): Promise<Parse> =>
  import("marked").then(({ marked }) => {
    marked.setOptions({ gfm: true, breaks: false });
    parse = (body) => marked.parse(body) as string;
    return parse;
  });

export function Markdown({ body }: { body: string }) {
  const [html, setHtml] = useState(() => (parse ? parse(body) : ""));
  useEffect(() => {
    let live = true;
    void (parse ? Promise.resolve(parse) : loadParse()).then((p) => {
      if (live) setHtml(p(body));
    });
    return () => {
      live = false;
    };
  }, [body]);
  return (
    // The app has no global prose styles (it is an editor), so element styles are scoped here rather than leaked.
    <div
      className={[
        "text-xs leading-relaxed text-muted-foreground",
        "[&_h2]:mb-1 [&_h2]:mt-5 [&_h2]:font-mono [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground",
        "[&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-foreground",
        "[&_p]:my-2",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_a]:underline [&_a]:decoration-dotted",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        // Inline code. The `pre code` reset below undoes this inside a block, where the pre already provides the frame.
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-foreground",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-2.5",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11px] [&_pre_code]:leading-snug",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
        "[&_th]:border-b [&_th]:border-border [&_th]:py-1 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground",
        "[&_td]:border-b [&_td]:border-border/40 [&_td]:py-1 [&_td]:pr-3 [&_td]:align-top",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic",
      ].join(" ")}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: build-time markdown from k7/docs/, never user input — see the note at the top of this file.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
