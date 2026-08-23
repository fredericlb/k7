import { Button } from "@frediverse/ui/button";
import { useRef, useState } from "react";
import type { SheetFile } from "../types";

interface Props {
  sheets: SheetFile[];
  // Resolve a file's stream URL (backend serves it with the right mime).
  urlFor: (fileId: string) => string;
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (fileId: string) => Promise<void>;
}

const ACCEPT = "application/pdf,image/*";

// A sheet is files, not text, so this is an uploader and a viewer rather than a textarea.
export function SheetPanel({ sheets, urlFor, onUpload, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    setBusy(true);
    try {
      await onUpload(files);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (file: SheetFile) => {
    if (!confirm(`Remove "${file.name}"?`)) return;
    setBusy(true);
    try {
      await onDelete(file.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-panel">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />

      <div className="row" style={{ marginBottom: 8 }}>
        <Button onClick={pick} disabled={busy}>
          {busy ? "Uploading…" : "＋ Add PDF or images"}
        </Button>
      </div>

      {sheets.length === 0 ? (
        <p className="muted">No sheet yet — add a PDF or one or more images.</p>
      ) : (
        <div className="sheet-files">
          {sheets.map((file) =>
            file.mime === "application/pdf" ? (
              <figure key={file.id} className="sheet-file">
                <figcaption className="sheet-file-head">
                  <span className="sheet-file-name" title={file.name}>
                    {file.name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => remove(file)}
                    title="Remove this file"
                  >
                    🗑
                  </Button>
                </figcaption>
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
            ) : (
              // Images stack flush, like the pages of a score, so they carry no caption.
              <div key={file.id} className="sheet-image-wrap">
                <img
                  className="sheet-image"
                  src={urlFor(file.id)}
                  alt=""
                  loading="lazy"
                />
                <button
                  type="button"
                  className="sheet-image-del"
                  disabled={busy}
                  onClick={() => remove(file)}
                  title="Remove this image"
                  aria-label="Remove image"
                >
                  🗑
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
