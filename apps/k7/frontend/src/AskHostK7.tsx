// AskHostK7.tsx — project-shell's question host, its buttons in the app's language.
// Every k7 page mounts this rather than the bare host, whose words are English (packages/project-shell/docs/ask.md).

import { AskHost } from "@studio/project-shell/ask";
import { m } from "./paraglide/messages.js";

export function AskHostK7() {
  return (
    <AskHost
      labels={{ cancel: m["common.cancel"](), confirm: m["common.confirm"]() }}
    />
  );
}
