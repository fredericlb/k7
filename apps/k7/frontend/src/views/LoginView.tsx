/* The RECOVERY screen, not the way in: k7 has no sign-in page of its own, and an
   anonymous tab leaves for pl8's /auth/login on its own (see auth.ts). This is
   what is left when that trip came back with no session — a dead end otherwise,
   since bouncing again would only loop. */

import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
import { m } from "../paraglide/messages.js";

interface Props {
  loginUrl: string;
}

export function LoginView({ loginUrl }: Props) {
  return (
    <SignInScreen
      title={
        <span className="brand login-brand">
          {/* BASE_URL, not "/": vite rewrites index.html, never a JSX string. */}
          <img
            className="brand-icon"
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt=""
          />
          f<span style={{ color: "var(--red)" }}>·</span>rec
        </span>
      }
      description={m["login.failed"]()}
      className="text-center"
    >
      <Button
        className="w-full"
        onClick={() => {
          window.location.href = loginUrl;
        }}
      >
        <FrediverseMark size="sm" />
        {m["login.retry"]()}
      </Button>
    </SignInScreen>
  );
}
