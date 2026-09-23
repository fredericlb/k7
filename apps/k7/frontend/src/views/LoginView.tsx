/* The RECOVERY screen, not the way in: k7 has no sign-in page of its own, and an
   anonymous tab leaves for pl8's /auth/login on its own (see auth.ts). This is
   what is left when that trip came back with no session — a dead end otherwise,
   since bouncing again would only loop. */

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { m } from "../paraglide/messages.js";

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
        <p className="muted">{m["login.failed"]()}</p>
        <Button
          className="mt-3 w-full"
          onClick={() => {
            window.location.href = loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          {m["login.retry"]()}
        </Button>
      </Card>
    </div>
  );
}
