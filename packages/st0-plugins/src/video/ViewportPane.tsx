// ViewportPane.tsx — the video plugin's drawer: the ADAPTER between the mounts' ctx and
// ViewportTab. The ctx names the compiled picture `videoDoc`; ViewportTab's props say `doc` —
// one component, two spellings, and this is the file that spells the difference. The optionals
// (track order, readOnly, the armed lane) are the SHELL pane's; a device's mount hands none.

import { ViewportTab, type ViewportTabProps } from "./ViewportTab";

/** A structural subset of both mounts' ctx — the shell's full ctx assigns to it (docs/sdk.md). */
export type ViewportPaneProps = {
  videoDoc: ViewportTabProps["doc"];
  videoError: ViewportTabProps["error"];
  trackIds?: ViewportTabProps["trackIds"];
  readOnly?: ViewportTabProps["readOnly"];
  armed?: ViewportTabProps["armed"];
};

export function ViewportPane(props: ViewportPaneProps) {
  return (
    <ViewportTab
      doc={props.videoDoc}
      error={props.videoError}
      trackIds={props.trackIds}
      readOnly={props.readOnly}
      armed={props.armed}
    />
  );
}

export { ViewportTab };
