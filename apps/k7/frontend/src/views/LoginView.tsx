/* The RECOVERY screen, not the way in: k7 has no sign-in page of its own, and an
   anonymous tab leaves for st0's /auth/login on its own (see auth.ts). This is
   what is left when that trip came back with no session — a dead end otherwise,
   since bouncing again would only loop. */

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";

interface Props {
  loginUrl: string;
}

export function LoginView({ loginUrl }: Props) {
  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="brand">
          {/* BASE_URL, not "/": vite rewrites index.html, never a JSX string. */}
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt=""
          />
          f<span style={{ color: "var(--red)" }}>·</span>rec
        </div>
        <p className="muted">
          Sign-in did not come back with a session. If it keeps failing, the
          médiathèque (which signs everyone in) may be down.
        </p>
        <Button
          className="mt-3 w-full"
          onClick={() => {
            window.location.href = loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          Try again
        </Button>
      </Card>
    </div>
  );
}
