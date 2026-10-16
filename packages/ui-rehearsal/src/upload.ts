// upload.ts — a request body sent through XMLHttpRequest, for the one thing fetch cannot report:
// how much of it has left. It answers a Response, so the callers read it exactly as a fetch's.
// ui-library holds the same few lines: no package both depend on is the place (../docs/recordings.md).

export interface UploadInit {
  method?: string;
  headers?: Record<string, string>;
  body: XMLHttpRequestBodyInit;
  signal?: AbortSignal;
  /** Called as the bytes leave, with the share sent so far (0 to 1). */
  onProgress?: (fraction: number) => void;
  /** Sends the cookies cross-origin too, as fetch's `credentials: "include"`. */
  withCredentials?: boolean;
}

export function upload(url: string, init: UploadInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", url);
    xhr.withCredentials = !!init.withCredentials;
    for (const [k, v] of Object.entries(init.headers ?? {}))
      xhr.setRequestHeader(k, v);
    xhr.responseType = "blob";
    const onAbort = () => xhr.abort();
    if (init.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    init.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => init.signal?.removeEventListener("abort", onAbort);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0)
        init.onProgress?.(e.loaded / e.total);
    };
    xhr.upload.onload = () => init.onProgress?.(1);
    xhr.onload = () => {
      done();
      // A null-body status refuses a body in the Response constructor.
      const empty = [204, 205, 304].includes(xhr.status);
      resolve(
        new Response(empty ? null : (xhr.response as Blob), {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: {
            "content-type": xhr.getResponseHeader("content-type") ?? "",
          },
        }),
      );
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError("Failed to fetch"));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(init.body);
  });
}
