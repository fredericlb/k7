import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Check, Copy, EllipsisVertical } from "@frediverse/ui/icons";
import { pageVersion } from "@studio/rehearsal-shared/pageVersion";
import { useState } from "react";
import { BackButton } from "../components/BackButton";
import { PageNametagForm } from "../components/PageNametagForm";
import { TrackCard } from "../components/TrackCard";
import { isOne } from "../i18n";
import { m } from "../paraglide/messages.js";
import type { Page, Release, SongEnvelope } from "../types";

interface Props {
  page: Page;
  allReleases: Release[];
  publicUrl: string;
  onRemoveRelease: (id: string) => Promise<void>;
  onAddRelease: (id: string) => Promise<void>;
  /** An empty versionId means "the release's default". */
  onChooseVersion: (releaseId: string, versionId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** "Edit": the nametag, which is the public link too. */
  onRename: (nametag: string) => Promise<void>;
  versionAudioUrl: (releaseId: string, versionId: string) => string;
  versionDownloadUrl: (releaseId: string, versionId: string) => string;
  versionEnvelope: (
    releaseId: string,
    versionId: string,
  ) => Promise<SongEnvelope>;
  onBack: () => void;
}

export function PageDetailView({
  page,
  onBack,
  allReleases,
  publicUrl,
  onRemoveRelease,
  onAddRelease,
  onChooseVersion,
  onDelete,
  onRename,
  versionAudioUrl,
  versionDownloadUrl,
  versionEnvelope,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const remove = async () => {
    if (!confirm(m["page.confirmDelete"]())) return;
    await onDelete();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const releases = page.releases ?? [];
  const notInPage = allReleases.filter((r) => !page.releaseIds.includes(r.id));

  return (
    <div className="release-detail">
      {editing ? (
        <PageNametagForm
          nametag={page.nametag}
          onSave={async (nametag) => {
            await onRename(nametag);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="detail-head">
          <BackButton to={m["nav.publications"]()} onClick={onBack} />
          <h2>@{page.nametag}</h2>
          <span className="muted detail-head-sub">
            {isOne(releases.length)
              ? m["page.releaseCount.one"]({ n: releases.length })
              : m["page.releaseCount.other"]({ n: releases.length })}
          </span>
          {/* The address itself stays off the page; this is how it is handed out. */}
          <Button
            variant="ghost"
            size="sm"
            className="ds-button shrink-0"
            onClick={copyLink}
          >
            {copied ? (
              <>
                <Check className="size-4" /> {m["common.copied"]()}
              </>
            ) : (
              <>
                <Copy className="size-4" /> {m["page.copyLink"]()}
              </>
            )}
          </Button>
          {/* The page's verbs in one ⋮, like a release's. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ds-button"
                title={m["page.menu"]()}
                aria-label={m["page.menu"]()}
              >
                <EllipsisVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="rehearsal-root" align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                {m["common.edit"]()}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => void remove()}
              >
                {m["page.delete"]()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <h3>{m["page.releases"]()}</h3>
      {releases.length === 0 && (
        <p className="muted">{m["page.noReleases"]()}</p>
      )}
      {releases.map((r) => {
        const played = pageVersion(page, r);
        const def = r.versions?.find((v) => v.id === r.defaultVersionId);
        const choices = (r.versions ?? []).filter((v) => !v.hidden);
        // A choice that fell back (hidden or deleted) shows as the default it now plays.
        const chosen = played && played.id !== def?.id ? played.id : "";
        return (
          <TrackCard
            key={r.id}
            title={
              <>
                {r.title} <span className="muted">· {r.artist}</span>
              </>
            }
            picker={{
              label: m["track.versionOf"]({ title: r.title }),
              value: chosen,
              options: [
                {
                  value: "",
                  label: def
                    ? m["page.defaultVersionNamed"]({ name: def.name })
                    : m["page.defaultVersion"](),
                },
                ...choices
                  .filter((v) => v.id !== def?.id)
                  .map((v) => ({ value: v.id, label: v.name })),
              ],
              onChange: (id) => void onChooseVersion(r.id, id),
            }}
            menu={[
              ...(r.canDownload && played
                ? [
                    {
                      label: m["common.download"](),
                      href: versionDownloadUrl(r.id, played.id),
                    },
                  ]
                : []),
              {
                label: m["page.removeRelease"](),
                onSelect: () => void onRemoveRelease(r.id),
              },
            ]}
            menuLabel={m["track.menu"]({ title: r.title })}
            audio={
              played
                ? {
                    src: versionAudioUrl(r.id, played.id),
                    shapeOf: () => versionEnvelope(r.id, played.id),
                  }
                : null
            }
          />
        );
      })}

      {notInPage.length > 0 && (
        <Card>
          <h3 style={{ marginTop: 0 }}>{m["page.addRelease"]()}</h3>
          <div className="row">
            <select
              disabled={adding}
              defaultValue=""
              onChange={async (e) => {
                const id = e.target.value;
                if (!id) return;
                setAdding(true);
                try {
                  await onAddRelease(id);
                } finally {
                  setAdding(false);
                  e.target.value = "";
                }
              }}
            >
              <option value="">{m["page.chooseRelease"]()}</option>
              {notInPage.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.artist}
                </option>
              ))}
            </select>
          </div>
        </Card>
      )}
    </div>
  );
}
