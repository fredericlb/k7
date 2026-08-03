/* Mint a personal access token for CLI use. Behind the cookie session (you
   generate it from the logged-in app), so no Bearer path here.
*/

import { sub, wrap } from "@frediverse/http";
import { Router } from "express";
import { issueApiToken } from "../apitoken.ts";

export const tokenRouter = Router();

tokenRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json({ token: issueApiToken(sub(req)) });
  }),
);
