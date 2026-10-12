// PublicPages.tsx — the two rehearsal addresses a host draws OUTSIDE its frame: a public page,
// `<prefix>/@<nametag>`, which nobody signs in to see, and the phone's microphone, `<prefix>/remote`.

import { PublicPageContainer } from "./containers/PublicPageContainer";
import { RemoteMicView } from "./views/RemoteMicView";
import "./styles/index.css";

export function RehearsalPublicPage({ nametag }: { nametag: string }) {
  return (
    <div className="rehearsal-root rehearsal-page rehearsal-standalone">
      <main className="main">
        <div className="main-inner">
          <PublicPageContainer nametag={nametag} />
        </div>
      </main>
    </div>
  );
}

export function RehearsalRemote() {
  return (
    <div className="rehearsal-root rehearsal-page rehearsal-standalone">
      <main className="main">
        <div className="main-inner">
          <RemoteMicView />
        </div>
      </main>
    </div>
  );
}
