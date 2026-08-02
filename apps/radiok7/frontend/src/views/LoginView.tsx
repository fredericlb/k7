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
          <img className="brand-icon" src="/icon-192.png" alt="" />f
          <span style={{ color: "var(--red)" }}>·</span>rec
        </div>
        <p className="muted">
          Record long sessions, auto-detect the loud moments, tag the good bits.
        </p>
        <Button
          className="mt-3 w-full"
          onClick={() => {
            window.location.href = loginUrl;
          }}
        >
          <FrediverseMark size="sm" />
          Sign in
        </Button>
      </Card>
    </div>
  );
}
