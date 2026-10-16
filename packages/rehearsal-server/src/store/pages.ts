// pages.ts — a page: a named collection of releases, opened by its nametag, with the version each
// release plays there and who may open it (../../docs/pages.md).

import { randomUUID } from "node:crypto";
import type { Release } from "@studio/rehearsal-shared";
import {
  PAGE_VISIBILITIES,
  type PageVisibility,
} from "@studio/rehearsal-shared/pageVisibility";
import type { Row } from "../db.ts";
import * as db from "../db.ts";
import type { FieldsOf } from "../schema.ts";
import { getRelease } from "./releases.ts";

type PageRow = Row<"Pages">;

function publicPage(rec: PageRow) {
  const f = rec.fields;
  return {
    id: f.Uid,
    ownerId: f.OwnerId,
    nametag: f.Nametag || "",
    releaseIds: String(f.ReleaseUids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    versionIds: versionChoicesOf(rec),
    visibility: visibilityOf(f.Visibility),
    createdAt: f.CreatedAt || "",
  };
}

// Empty is a row from before the field, which was served to anyone: it stays public — ../../docs/pages.md.
function visibilityOf(raw: unknown): PageVisibility {
  if (raw === "" || raw === undefined || raw === null) return "public";
  return PAGE_VISIBILITIES.includes(raw as PageVisibility)
    ? (raw as PageVisibility)
    : "private";
}

// VersionChoices is a JSON object { releaseUid: versionUid }; anything else reads as "no choice".
function versionChoicesOf(rec: PageRow): Record<string, string> {
  try {
    const parsed = JSON.parse(rec.fields.VersionChoices || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function getPageRecord(uid: string): Promise<PageRow | null> {
  const recs = await db.listRecords("Pages", { Uid: [uid] });
  return recs[0] || null;
}

export async function getPageOwner(uid: string): Promise<string | null> {
  const rec = await getPageRecord(uid);
  return rec ? rec.fields.OwnerId : null;
}

/** The pages answering to a nametag, whatever its case: `Band` and `band` are one address — ../../docs/pages.md. */
async function pagesNamed(nametag: string) {
  const wanted = String(nametag).toLowerCase();
  const recs = await db.listRecords("Pages", undefined, {
    fields: ["Uid", "Nametag"],
  });
  return recs.filter((r) => String(r.fields.Nametag).toLowerCase() === wanted);
}

export async function nametagExists(
  nametag: string,
  exceptUid?: string,
): Promise<boolean> {
  const recs = await pagesNamed(nametag);
  return recs.some((r) => r.fields.Uid !== exceptUid);
}

// The nametag is the whole address of a public page — see routes/publicPages.ts.
export async function getPageByNametag(nametag: string) {
  const recs = await pagesNamed(nametag);
  return recs[0] ? getPage(recs[0].fields.Uid) : null;
}

export async function listPages(ownerId: string) {
  const recs = await db.listRecords("Pages", { OwnerId: [ownerId] });
  return recs
    .map(publicPage)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getPage(uid: string) {
  const rec = await getPageRecord(uid);
  if (!rec) return null;
  const page = publicPage(rec);
  const releases: Release[] = [];
  for (const rid of page.releaseIds) {
    const r = await getRelease(rid);
    if (r && r.ownerId === page.ownerId) releases.push(r);
  }
  return { ...page, releases };
}

export async function createPage(
  ownerId: string,
  {
    nametag,
    releaseIds,
    visibility,
  }: { nametag: string; releaseIds?: string[]; visibility?: PageVisibility },
) {
  const uid = randomUUID();
  const createdAt = new Date().toISOString();
  await db.addRecords("Pages", [
    {
      Uid: uid,
      OwnerId: ownerId,
      Nametag: nametag,
      ReleaseUids: (releaseIds || []).join(","),
      Visibility: visibility || "private",
      CreatedAt: createdAt,
    },
  ]);
  return getPage(uid);
}

export async function updatePage(
  uid: string,
  patch: {
    nametag?: string;
    releaseIds?: string[];
    versionIds?: Record<string, string>;
    visibility?: PageVisibility;
  },
) {
  const rec = await getPageRecord(uid);
  if (!rec) return null;
  const fields: Partial<FieldsOf<"Pages">> = {};
  if (patch.nametag !== undefined) fields.Nametag = patch.nametag;
  if (patch.releaseIds !== undefined)
    fields.ReleaseUids = patch.releaseIds.join(",");
  if (patch.versionIds !== undefined)
    fields.VersionChoices = JSON.stringify(patch.versionIds);
  if (patch.visibility !== undefined) fields.Visibility = patch.visibility;
  await db.patchRecord("Pages", rec.id, fields);
  return getPage(uid);
}

export async function deletePage(uid: string): Promise<boolean> {
  const rec = await getPageRecord(uid);
  if (!rec) return false;
  await db.deleteRecords("Pages", [rec.id]);
  return true;
}
