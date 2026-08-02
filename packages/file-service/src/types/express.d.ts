import type { Workspace } from "../workspace.ts";

// The workspace context resolved per-request from the user + workspace headers.
declare global {
  namespace Express {
    interface Request {
      userEmail?: string; // from x-lanes-user (set by resolveUser)
      ws?: Workspace; // from userEmail + x-lanes-workspace (set by resolveWorkspace)
    }
  }
}
