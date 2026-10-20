// client.ts — the one QueryClient of the page, with defaults that change nothing about WHEN
// a read happens: a key moving is what refetches, never focus, reconnect or a timer. The one
// thing to know: `networkMode: "always"`, since a desktop app with no internet still reaches its
// own loopback server, and the default would hold every read while `navigator.onLine` is false.

import { QueryClient } from "@tanstack/react-query";

/** The reload counters a cached read can be keyed by: the shell's, and a second device's surface. */
export const SHELL_SCOPE = "shell";
export const DEVICE_SCOPE = "device";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // A read keyed by a reload counter is answered for good: the next reload is a new key.
      staleTime: Number.POSITIVE_INFINITY,
      // Old keys go a minute after their last reader, which is long enough for a seed to be taken.
      gcTime: 60_000,
      retry: false,
    },
  },
});
