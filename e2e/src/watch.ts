// watch.ts — what counts as a page going wrong while a spec drives it: an uncaught error, or a 5xx.
// A 4xx and a console.error are noted on the report rather than failed on, since some are the app asking a question.
import { expect, type Page, test } from "@playwright/test";

export function watchPage(page: Page) {
  const problems: string[] = [];
  const notes = new Set<string>();
  const onError = (err: Error) => problems.push(`pageerror: ${err.message}`);
  const onResponse = (res: { status(): number; url(): string }) => {
    const path = new URL(res.url()).pathname;
    if (res.status() >= 500) problems.push(`${res.status()} ${res.url()}`);
    else if (res.status() >= 400) notes.add(`${res.status()} ${path}`);
  };
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (
      msg.type() === "error" &&
      !msg.text().startsWith("Failed to load resource")
    )
      notes.add(msg.text().slice(0, 300));
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("console", onConsole);
  return {
    problems,
    assertClean() {
      page.off("pageerror", onError);
      page.off("response", onResponse);
      page.off("console", onConsole);
      for (const note of notes)
        test.info().annotations.push({ type: "noted", description: note });
      expect(problems).toEqual([]);
    },
  };
}
