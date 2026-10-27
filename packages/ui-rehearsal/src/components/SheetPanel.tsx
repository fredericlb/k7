import { Button } from "@frediverse/ui/button";
import { Trash2 } from "@frediverse/ui/icons";
import { sheetKind } from "@studio/rehearsal-shared/sheetKind";
import { useState } from "react";
import { confirmLoss } from "../confirm";
import { m } from "../paraglide/messages.js";
import type { SheetFile } from "../types";
import { ScoreSheet } from "./ScoreSheet";

interface Props {
  sheets: SheetFile[];
  // Resolve a file's stream URL (backend serves it with the right mime).
  urlFor: (fileId: string) => string;
  /** Absent, the sheets are read-only: a copy of a server's song. */
  onDelete?: (fileId: string) => Promise<void>;
  /** The page's transposition, which a score starts from; its own toolbar still moves it. */
  transpose?: number;
}

// A sheet is files, not text: this draws them and removes them; adding is the song page's bottom link.
export function SheetPanel({ sheets, urlFor, onDelete, transpose = 0 }: Props) {
  const [busy, setBusy] = useState(false);

  const remove = async (file: SheetFile) => {
    if (!(await confirmLoss(m["sheet.remove"]({ name: file.name })))) return;
    setBusy(true);
    try {
      await onDelete?.(file.id);
    } finally {
      setBusy(false);
    }
  };

  const caption = (file: SheetFile) => (
    <figcaption className="sheet-file-head">
      <span className="sheet-file-name" title={file.name}>
        {file.name}
      </span>
      {onDelete && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => remove(file)}
          title={m["sheet.removeFile"]()}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </figcaption>
  );

  return (
    <div className="sheet-panel">
      <div className="sheet-files">
        {sheets.map((file) => {
          const kind = sheetKind(file.name, file.mime);
          // Asked first: anything this does not name as a PDF would otherwise be drawn as an image.
          if (kind === "score")
            return (
              <figure key={file.id} className="sheet-file">
                {caption(file)}
                <ScoreSheet url={urlFor(file.id)} transpose={transpose} />
              </figure>
            );
          if (kind === "pdf")
            return (
              <figure key={file.id} className="sheet-file">
                {caption(file)}
                <object
                  className="sheet-pdf"
                  data={urlFor(file.id)}
                  type="application/pdf"
                >
                  <a href={urlFor(file.id)} target="_blank" rel="noreferrer">
                    Open {file.name}
                  </a>
                </object>
              </figure>
            );
          return (
            // Images stack flush, like the pages of a score, so they carry no caption.
            <div key={file.id} className="sheet-image-wrap">
              <img
                className="sheet-image"
                src={urlFor(file.id)}
                alt=""
                loading="lazy"
              />
              {onDelete && (
                <button
                  type="button"
                  className="sheet-image-del"
                  disabled={busy}
                  onClick={() => remove(file)}
                  title={m["sheet.removeImage"]()}
                  aria-label={m["sheet.removeImage"]()}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
