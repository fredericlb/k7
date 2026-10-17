// version.ts — what this backend says it is: the repository's one version, and the image's build stamp.
// The version is this package.json's, which scripts/check-version.mjs keeps equal to the root's (docs/versioning.md).

import pkg from "../package.json" with { type: "json" };

/** The release version, `0.1.0`: the same in an image, the desktop app and the phone. */
export const VERSION: string = pkg.version;

/** The image's `YY.MMDDHHmm` stamp (the Dockerfile's APP_VERSION); `dev` outside an image. */
export const BUILD: string = process.env.APP_VERSION || "dev";
