import { Badge } from "@frediverse/ui/badge";
import { X } from "@frediverse/ui/icons";
import { useRef, useState } from "react";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}

/** A chip input for tags: Enter or comma adds, Backspace on empty removes, ↑/↓ picks. */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "#tag",
  disabled,
}: Props) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, "");
    setDraft("");
    setHighlight(0);
    if (t && !value.includes(t)) onChange([...value, t]);
  };

  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  // Existing tags not already applied, matching the current draft (substring).
  const q = draft.trim().replace(/^#/, "").toLowerCase();
  const matches = suggestions
    .filter((s) => !value.includes(s))
    .filter((s) => !q || s.toLowerCase().includes(q));

  const showList = open && matches.length > 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (showList && highlight < matches.length) add(matches[highlight]);
      else add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === "ArrowDown" && showList) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp" && showList) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="tag-input">
      <div className={`tag-field${disabled ? " disabled" : ""}`}>
        {value.map((t) => (
          <Badge key={t} variant="tag">
            #{t}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[15px] font-bold leading-none text-inherit"
              disabled={disabled}
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          className="tag-draft"
          value={draft}
          disabled={disabled}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            setHighlight(0);
            setOpen(true);
            if (e.target.value.includes(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            add(draft);
          }}
        />
      </div>
      {showList && (
        <ul className="tag-suggestions">
          {matches.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className={`tag-suggestion${i === highlight ? " active" : ""}`}
                // Fire before the input's blur so the click isn't cancelled.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(s);
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                #{s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
