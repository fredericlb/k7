import { useMemo, useState } from "react";
import { parseTablature, type TabNode } from "./tab";
import "./styles.css";

interface Props {
  text: string;
}

// Layout constants (px). COL_W matches the monospace column width so events land
// under the same columns they occupy in the source ASCII.
const COL_W = 9;
const ROW_H = 18;
const GUTTER = 24;
const PAD_Y = 12;
const RIGHT_PAD = 10;

function System({ node }: { node: Extract<TabNode, { type: "system" }> }) {
  const n = node.strings.length;
  const width = GUTTER + node.cols * COL_W + RIGHT_PAD;
  const height = PAD_Y * 2 + (n - 1) * ROW_H;
  const yRow = (r: number) => PAD_Y + r * ROW_H;
  const lineEnd = GUTTER + node.cols * COL_W;

  return (
    <div className="tab-system">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
      >
        {/* string lines + labels */}
        {node.strings.map((s, r) => (
          <g key={r}>
            <line
              className="tab-string"
              x1={GUTTER}
              y1={yRow(r)}
              x2={lineEnd}
              y2={yRow(r)}
            />
            {s.label && (
              <text
                className="tab-label"
                x={GUTTER - 6}
                y={yRow(r)}
                textAnchor="end"
                dominantBaseline="central"
              >
                {s.label}
              </text>
            )}
          </g>
        ))}
        {/* bar lines */}
        {node.bars.map((b) => (
          <line
            key={`bar-${b}`}
            className="tab-bar"
            x1={GUTTER + b * COL_W}
            y1={yRow(0)}
            x2={GUTTER + b * COL_W}
            y2={yRow(n - 1)}
          />
        ))}
        {/* fret numbers + techniques, each masked so the string line reads clearly */}
        {node.strings.map((s, r) =>
          s.events.map((e, i) => {
            const x = GUTTER + e.col * COL_W;
            const w = e.text.length * COL_W;
            return (
              <g key={`e-${r}-${i}`}>
                <rect
                  className="tab-mask"
                  x={x - 1}
                  y={yRow(r) - 7}
                  width={w + 2}
                  height={14}
                />
                <text
                  className={e.kind === "fret" ? "tab-fret" : "tab-technique"}
                  x={x}
                  y={yRow(r)}
                  dominantBaseline="central"
                >
                  {e.text}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

function renderNode(node: TabNode, key: string) {
  switch (node.type) {
    case "empty":
      return <div key={key} className="tab-empty" />;
    case "section":
      return (
        <div key={key} className="tab-section">
          {node.label}
        </div>
      );
    case "text":
      return (
        <div key={key} className="tab-textline">
          {node.text}
        </div>
      );
    case "system":
      return <System key={key} node={node} />;
  }
}

export function Tablature({ text }: Props) {
  const nodes = useMemo(() => parseTablature(text), [text]);
  const [headerOpen, setHeaderOpen] = useState(false);

  // Everything before the first tab system is a header (title, tuning, legend…).
  const firstSystem = nodes.findIndex((n) => n.type === "system");
  const header = firstSystem > 0 ? nodes.slice(0, firstSystem) : [];
  const hasHeader = header.some(
    (n) => n.type === "section" || n.type === "text",
  );
  const body = hasHeader ? nodes.slice(firstSystem) : nodes;

  return (
    <div className="tab-sheet">
      {hasHeader && (
        <div className="tab-header">
          <button
            className="tab-header-toggle"
            onClick={() => setHeaderOpen((o) => !o)}
            aria-expanded={headerOpen}
          >
            {headerOpen ? "▾ Hide header" : "▸ Show header"}
          </button>
          {headerOpen && (
            <div className="tab-header-body">
              {header.map((n, i) => renderNode(n, `h-${i}`))}
            </div>
          )}
        </div>
      )}
      {body.map((n, i) => renderNode(n, `b-${i}`))}
    </div>
  );
}
