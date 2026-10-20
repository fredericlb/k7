// call.ts — what every browser call to a studio service does with an answer: a refusal becomes an
// HttpError carrying the server's own sentence and its status, a success is read as JSON.
// The fallback sentence is the caller's, since only it knows its words and its language (../docs/httpClient.md).

/** A refused call: the server's sentence when it sent one, and the status a caller tells a 404 by. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What to say when the server said nothing: `"<what> <status>"`, or the caller's own sentence. */
export type Fallback = string | ((status: number) => string);

/** The error a failed response carries; reads its body, so call it once and only on a refusal. */
export async function failed(
  res: Response,
  fallback: Fallback,
): Promise<HttpError> {
  const said = (await res.json().catch(() => ({}))) as { error?: string };
  const otherwise =
    typeof fallback === "string"
      ? `${fallback} ${res.status}`
      : fallback(res.status);
  return new HttpError(said.error ?? otherwise, res.status);
}

/** The answer as JSON, or the refusal thrown. */
export async function readJson<T>(
  res: Response,
  fallback: Fallback,
): Promise<T> {
  if (!res.ok) throw await failed(res, fallback);
  return (await res.json()) as T;
}

/** `fetch` within `ms` (none when null); the budget running out throws `onTimeout`, a caller's own cancel stays an AbortError. */
export async function fetchWithin(
  url: string,
  init: RequestInit,
  ms: number | null,
  onTimeout: (seconds: number) => Error,
): Promise<Response> {
  const limit = ms === null ? null : AbortSignal.timeout(ms);
  const signals = [init.signal, limit].filter((s): s is AbortSignal => !!s);
  try {
    return await fetch(url, {
      ...init,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch (e) {
    if (limit?.aborted && !init.signal?.aborted)
      throw onTimeout((ms ?? 0) / 1000);
    throw e;
  }
}
