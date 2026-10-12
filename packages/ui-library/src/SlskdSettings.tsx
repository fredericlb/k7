// SlskdSettings.tsx — the settings screen's slskd card: the daemon's address and key, and the
// SFTP access to the machine it downloads onto. A secret on file is never shown, only said to be
// there; typing over it replaces it, "Forget" clears it. See ../docs/settings.md.

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { CircleCheck, CircleX, Loader2 } from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { Textarea } from "@frediverse/ui/textarea";
import type {
  CheckResult,
  SlskdSettings as Saved,
  SlskdCheck,
  SlskdSettingsInput,
} from "@studio/web-protocol/settings";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { settings } from "./api";
import { useLabels } from "./host";

type Secret = "apiKey" | "sftpPassword" | "sftpKey" | "sftpPassphrase";

const ON_FILE: Record<Secret, keyof Saved> = {
  apiKey: "hasApiKey",
  sftpPassword: "hasSftpPassword",
  sftpKey: "hasSftpKey",
  sftpPassphrase: "hasSftpPassphrase",
};

const EMPTY_SECRETS: Record<Secret, string> = {
  apiKey: "",
  sftpPassword: "",
  sftpKey: "",
  sftpPassphrase: "",
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function CheckLine({ name, r }: { name: string; r: CheckResult }) {
  const Icon = r.ok ? CircleCheck : CircleX;
  return (
    <p
      className={`flex items-start gap-2 text-xs ${r.ok ? "text-emerald-500" : "text-destructive"}`}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span>
        <b>{name}</b> — {r.detail}
      </span>
    </p>
  );
}

export function SlskdSettings() {
  const labels = useLabels();
  const l = labels.slskd;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [plain, setPlain] = useState({
    url: "",
    sftpHost: "",
    sftpPort: "22",
    sftpUser: "",
    downloadsDir: "",
  });
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  // Secrets on file the person asked to clear, sent as "" on the next save.
  const [forget, setForget] = useState<Set<Secret>>(new Set());
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [check, setCheck] = useState<SlskdCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable, so the load below runs once and not on every render.
  const apply = useCallback((s: Saved) => {
    setSaved(s);
    setPlain({
      url: s.url,
      sftpHost: s.sftpHost,
      sftpPort: String(s.sftpPort),
      sftpUser: s.sftpUser,
      downloadsDir: s.downloadsDir,
    });
    setSecrets(EMPTY_SECRETS);
    setForget(new Set());
  }, []);

  useEffect(() => {
    settings
      .slskd()
      .then(apply)
      .catch((e: Error) => setError(e.message));
  }, [apply]);

  const runCheck = async () => {
    setBusy("check");
    try {
      setCheck(await settings.checkSlskd());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Saving tests at once: a form of eight fields is filled in to find out whether it works.
  const save = async () => {
    setBusy("save");
    setError(null);
    setCheck(null);
    const input: SlskdSettingsInput = {
      ...plain,
      sftpPort: Number(plain.sftpPort) || 22,
    };
    for (const k of Object.keys(secrets) as Secret[]) {
      if (secrets[k]) input[k] = secrets[k];
      else if (forget.has(k)) input[k] = "";
    }
    try {
      apply(await settings.saveSlskd(input));
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return;
    }
    await runCheck();
  };

  const text = (k: keyof typeof plain) => ({
    id: `slskd-${k}`,
    value: plain[k],
    onChange: (e: { target: { value: string } }) =>
      setPlain((p) => ({ ...p, [k]: e.target.value })),
  });

  const secret = (k: Secret) => {
    const onFile = Boolean(saved?.[ON_FILE[k]]) && !forget.has(k);
    return {
      id: `slskd-${k}`,
      value: secrets[k],
      autoComplete: "off",
      placeholder: onFile ? l.onFile : "",
      onChange: (e: { target: { value: string } }) =>
        setSecrets((s) => ({ ...s, [k]: e.target.value })),
    };
  };

  // Offered only on a secret that is on file and not already being cleared or replaced.
  const forgetButton = (k: Secret) =>
    saved?.[ON_FILE[k]] && !forget.has(k) && !secrets[k] ? (
      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline hover:text-foreground"
        onClick={() => setForget((f) => new Set(f).add(k))}
      >
        {l.forget}
      </button>
    ) : null;

  if (!saved && !error)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        {labels.common.loading}
      </Card>
    );

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div>
        <h3 className="font-semibold">slskd</h3>
        <p className="text-xs text-muted-foreground">{l.hint}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="slskd-url" label={l.address}>
          <Input {...text("url")} placeholder="https://slskd.lan:5031" />
        </Field>
        <Field id="slskd-apiKey" label={l.apiKey}>
          <Input type="password" {...secret("apiKey")} />
          {forgetButton("apiKey")}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field id="slskd-sftpHost" label={l.sftpHost}>
          <Input {...text("sftpHost")} placeholder="slskd.lan" />
        </Field>
        <Field id="slskd-sftpPort" label={l.port}>
          <Input {...text("sftpPort")} inputMode="numeric" />
        </Field>
        <Field id="slskd-sftpUser" label={l.user}>
          <Input {...text("sftpUser")} />
        </Field>
      </div>
      <Field id="slskd-downloadsDir" label={l.downloadsDir}>
        <Input {...text("downloadsDir")} placeholder="/downloads" />
      </Field>
      <Field id="slskd-sftpKey" label={l.sshKey}>
        <Textarea
          rows={4}
          className="font-mono text-xs"
          {...secret("sftpKey")}
        />
        {forgetButton("sftpKey")}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="slskd-sftpPassphrase" label={l.passphrase}>
          <Input type="password" {...secret("sftpPassphrase")} />
          {forgetButton("sftpPassphrase")}
        </Field>
        <Field id="slskd-sftpPassword" label={l.password}>
          <Input type="password" {...secret("sftpPassword")} />
          {forgetButton("sftpPassword")}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy !== null} onClick={() => void save()}>
          {busy === "save" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {l.save}
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => void runCheck()}
        >
          {busy === "check" && (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          )}
          {l.test}
        </Button>
      </div>

      {check && (
        <div className="flex flex-col gap-1">
          <CheckLine name="slskd" r={check.slskd} />
          <CheckLine name="SFTP" r={check.sftp} />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Card>
  );
}
