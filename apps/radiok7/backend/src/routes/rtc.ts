/* Small REST surface for the remote-microphone signaling: hand the authenticated
   SPA a short-lived ticket to open the signaling socket with, and let it check
   whether a remote device is currently available.
*/

import { sub, wrap } from "@frediverse/http";
import { Router } from "express";
import { hasRemote, issueTicket } from "../rtc.ts";

export const rtcRouter = Router();

rtcRouter.get(
  "/ticket",
  wrap(async (req, res) => {
    res.json({ ticket: issueTicket(sub(req)) });
  }),
);

rtcRouter.get(
  "/remote",
  wrap(async (req, res) => {
    res.json({ connected: hasRemote(sub(req)) });
  }),
);
