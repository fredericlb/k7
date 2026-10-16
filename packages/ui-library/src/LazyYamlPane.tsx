// LazyYamlPane.tsx — the module builder's YamlPane, fetched the first time a screen shows text.
// CodeMirror and its vim mode weigh more than every other screen of the library together, so a
// host that mounts the catalogue does not pay for them until a song or a playlist is opened as
// YAML — see ../docs/audit.md.

import { Loader2 } from "@frediverse/ui/icons";
import { type ComponentProps, lazy, Suspense } from "react";
import { useLabels } from "./host";

const Pane = lazy(() =>
  import("@studio/ui-module-builder/yaml-pane").then((m) => ({
    default: m.YamlPane,
  })),
);

export function YamlPane(props: ComponentProps<typeof Pane>) {
  const labels = useLabels();
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
          {labels.common.loading}
        </div>
      }
    >
      <Pane {...props} />
    </Suspense>
  );
}
