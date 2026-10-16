// rtc.ts — the phone-microphone signalling's calls.

import { f, json } from "./http";

export const rtcApi = {
  // --- Remote microphone signaling ---

  // A short-lived ticket to open the /rtc signaling socket with.
  rtcTicket: (): Promise<{ ticket: string }> => f("/api/rtc/ticket").then(json),
  // Whether a device is currently connected at /remote (offering its mic).
  rtcRemoteStatus: (): Promise<{ connected: boolean }> =>
    f("/api/rtc/remote").then(json),
};
