// The browser's door on a desk too short for the record: it must answer to the label's own name.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeckPick } from "./DeckSide";

const render = (title: string | null) =>
  renderToStaticMarkup(<DeckPick side="A" title={title} onPick={() => {}} />);

describe("DeckPick", () => {
  it("is a button named after its deck while the deck is empty", () => {
    // The name the record's label carries, so the desk answers to it at every height.
    const html = render(null);
    expect(html).toMatch(/^<button[^>]*>/);
    expect(html).toContain(">deck A</span>");
  });

  it("names the loaded song instead, as the label does", () => {
    expect(render("Teardrop")).toContain(">Teardrop</span>");
  });
});
