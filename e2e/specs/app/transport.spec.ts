// transport.spec.ts — Play moves the engine's clock and Stop halts it: the round trip browser → engine → browser.
// It plays a few seconds of synth-demo through the machine's output device (docs/e2e.md).
import { expect, test } from "../../src/target.ts";
import { clockOf, play } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

test("play advances the transport, stop halts it", async ({ k7 }) => {
  const page = await k7.open("/@local/Examples/synth-demo.k7");
  const watch = watchPage(page);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
  const clock = clockOf(page);
  const before = await play(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  // Stop returns the playhead to where play started, so read the clock once that has landed.
  await expect(clock).toHaveText(before);
  const stopped = await clock.innerText();
  await page.waitForTimeout(1_000);
  await expect(clock).toHaveText(stopped);
  watch.assertClean();
});
