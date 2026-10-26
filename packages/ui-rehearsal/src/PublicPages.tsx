// PublicPages.tsx — the rehearsal address a host draws OUTSIDE its frame: a public page,
// `<prefix>/@<nametag>`, which nobody signs in to see.

import { ServerOnly } from "./components/ServerOnly";
import { PublicPageContainer } from "./containers/PublicPageContainer";
import "./styles/index.css";

export function RehearsalPublicPage({ nametag }: { nametag: string }) {
  return (
    <div className="rehearsal-root rehearsal-page rehearsal-standalone">
      <main className="main">
        <div className="main-inner">
          {/* A public page is the server's, like every page: a local instance asks it there. */}
          <ServerOnly>
            <PublicPageContainer nametag={nametag} />
          </ServerOnly>
        </div>
      </main>
    </div>
  );
}
