// repoLookup.ts — the account's libraries, and nothing else. It asked pl8 for two things once:
// the library pointer, and the git URI behind a short name. The register is gone with the
// portable address, and the libraries moved to the machine that clones them —
// apps/k7/frontend/docs/projects.md.

import type {
  AccountLibrariesReply,
  AccountLibrary,
} from "@studio/web-protocol";
import { fget } from "./fileApi.ts";

/** THIS MACHINE's list: nothing outlives the machine that holds the clones, so the list lives beside them. */
export async function accountLibraries(): Promise<AccountLibrary[]> {
  const { libraries } = await fget<AccountLibrariesReply>("/account/libraries");
  return libraries ?? [];
}
