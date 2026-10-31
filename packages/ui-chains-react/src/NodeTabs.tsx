// NodeTabs.tsx — a panel's pages on its card: a column down the left under the header, or a menu
// across the top on a card too narrow to give a column half its width. Which page is open is the
// card's own state, or the host's when it sizes cards by tab — docs/nodeCard.md.

import {
  FOOTER_H,
  type GraphNode,
  TAB_COL_W,
  TAB_H,
  TAB_MENU_H,
  UI_CONTENT_TOP,
  UI_HEADER,
} from "@studio/ui-chains/graph";
import type { ChainsLabels } from "./labels";
import type { NodeProps } from "./nodeProps";

// The open tab in its column's view: a column longer than its card scrolls, and a lit tab out of sight says nothing.
function keepTabInView(el: HTMLButtonElement | null) {
  const col = el?.parentElement;
  if (!el || !col) return;
  if (el.offsetTop < col.scrollTop) col.scrollTop = el.offsetTop;
  else if (el.offsetTop + el.offsetHeight > col.scrollTop + col.clientHeight)
    col.scrollTop = el.offsetTop + el.offsetHeight - col.clientHeight;
}

/** Both forms of the tabs; the card draws them only when the panel has two to choose from. */
export function nodeTabs({
  n,
  tabs,
  openTab,
  setTabAt,
  onOpenTab,
  l,
}: Pick<NodeProps, "n" | "onOpenTab"> & {
  l: ChainsLabels;
  tabs: NonNullable<NonNullable<GraphNode["ui"]>["tabs"]>;
  openTab: number;
  setTabAt: (i: number) => void;
}) {
  return (
    <>
      {/* A NARROW card's tabs: a menu across its top, under the header, since a column would take half its width. */}
      {n.ui?.tabsAs === "dropdown" && (
        <select
          className="dgx-tabmenu"
          style={{ top: UI_CONTENT_TOP, height: TAB_MENU_H - 4 }}
          value={openTab}
          aria-label={l.page}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const i = Number(e.target.value);
            setTabAt(i);
            onOpenTab?.(n.id, i);
          }}
        >
          {tabs.map((t, i) => (
            <option key={t.name} value={i}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {/* The panel's TABS, a column down the card's left under the header — only when there are two to choose from. */}
      {n.ui?.tabsAs !== "dropdown" && (
        <div
          className="dgx-tabs"
          // Down to the bottom bar, which a module card carries and a strip does not.
          style={{
            top: UI_HEADER,
            width: TAB_COL_W,
            bottom: n.kind === "module" && !n.strip ? FOOTER_H : 0,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {tabs.map((t, i) => (
            <button
              key={t.name}
              type="button"
              ref={i === openTab ? keepTabInView : undefined}
              className={`dgx-tab${i === openTab ? " on" : ""}`}
              style={{ height: TAB_H }}
              title={t.name}
              onClick={(e) => {
                e.stopPropagation();
                setTabAt(i);
                onOpenTab?.(n.id, i);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
