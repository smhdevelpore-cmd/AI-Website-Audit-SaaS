/**
 * Local fixture websites for the crawler tests.
 *
 * Everything the crawler is allowed to touch in this suite is served by one of these on
 * 127.0.0.1. Nothing in CI reaches the public internet: a test that needs "a slow server" gets a
 * slow server, not example.com.
 *
 * The three overrides a test needs to reach 127.0.0.1 are deliberately awkward to get wrong:
 *
 *   1. `fixtureResolver` — a DNS answer, because `fixture.test` does not exist.
 *   2. `allowLoopback` — an address policy that permits only 127.0.0.1/::1.
 *   3. `allowedPorts: [server.port]` — because the policy otherwise allows only 80 and 443.
 *
 * Each of those has a companion test proving the *default* refuses the same thing, so these
 * helpers cannot be hiding a broken default.
 */

import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { assertPublicAddress, type HostResolver, type ResolvedAddress } from "@siteaudit/validation";

export type FixtureHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface FixtureServer {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  readonly port: number;
  /** Request paths in arrival order. */
  readonly hits: string[];
  /** The highest number of simultaneously open requests observed. */
  readonly maxConcurrent: number;
  reset(): void;
  close(): Promise<void>;
}

export async function startFixtureServer(handler: FixtureHandler): Promise<FixtureServer> {
  const hits: string[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;

  const server: Server = createServer((req, res) => {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    hits.push(req.url ?? "/");
    const done = (): void => {
      inFlight -= 1;
    };
    res.on("close", done);
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end("fixture error");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server did not bind");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    get hits() {
      return hits;
    },
    get maxConcurrent() {
      return maxConcurrent;
    },
    reset() {
      hits.length = 0;
      maxConcurrent = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** `fixture.test` and friends resolve to the local fixture server, whatever the real DNS says. */
export function fixtureResolver(...hosts: string[]): HostResolver {
  const allowed = new Set(hosts.length === 0 ? ["fixture.test"] : hosts);
  return async (hostname): Promise<ReadonlyArray<ResolvedAddress>> => {
    if (!allowed.has(hostname)) throw new Error(`unexpected DNS lookup for ${hostname}`);
    return [{ address: "127.0.0.1", family: 4 }];
  };
}

/**
 * The test-only address policy: loopback is permitted, everything else still goes through the
 * real gate. A production call never passes this.
 */
export function allowLoopback(address: string): void {
  if (address === "127.0.0.1" || address === "::1") return;
  assertPublicAddress(address);
}

/* ------------------------------------------------------------------ helpers */

export function html(
  res: ServerResponse,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location, "content-type": "text/html" });
  res.end("<p>moved</p>");
}

export function text(res: ServerResponse, body: string, contentType = "text/plain"): void {
  res.writeHead(200, { "content-type": contentType });
  res.end(body);
}

export function notFound(res: ServerResponse): void {
  html(res, "<html><body><h1>Not found</h1></body></html>", 404);
}

/** A page whose links are the interesting part. */
export function page(title: string, links: readonly string[] = [], extraHead = ""): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${extraHead}</head>` +
    `<body><h1>${title}</h1>` +
    links.map((href) => `<a href="${href}">${href}</a>`).join("") +
    `</body></html>`
  );
}
