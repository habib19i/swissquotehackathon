/** JSON calls to a key-share holder, with its refusals turned into plain-language errors. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function serviceClient(baseUrl: string, name: string) {
  return async function call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ServiceError(503, `${name} is not reachable right now.`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = res.status === 503 || res.status >= 502 ? `${name} is not reachable right now.` : (json.error ?? `${name} answered ${res.status}`);
      throw new ServiceError(res.status, message);
    }
    return json as T;
  };
}
