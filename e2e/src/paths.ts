// paths.ts — where the suite keeps what it writes, anchored to e2e/ whatever the working directory.
import { join } from "node:path";

export const AUTH_STATE = join(
  import.meta.dirname,
  "..",
  ".auth",
  "e2e-user.json",
);
