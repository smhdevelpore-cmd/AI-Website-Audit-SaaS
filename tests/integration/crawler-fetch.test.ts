/**
 * The fetch boundary, adversarially.
 *
 * Every case here is something a hostile (or merely broken) website can do to us, served by a
 * local fixture so the suite never touches the internet. The rule under test is always the same:
 * the request either goes to a public address we validated, or it does not happen at all.
 *
 * The three test-only overrides (`fixtureResolver`, `allowLoopback`, `allowedPorts`) are what let
 * a fixture server on 127.0.0.1:&lt;ephemeral&gt; be reachable. Their defaults are tested first, so
 * nothing below can pass by weakening the real gate.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { safeFetch, type FetchLimits, type SafeFetchOptions } from "@siteaudit/crawler";
import type { HostResolver } from "@siteaudit/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  allowLoopback,
  fixtureResolver,
  html,
  page,
  redirect,
  startFixtureServer,
  type FixtureServer,
} from "../support/fixture-server.js";

const HOST = "fixture.test";

function bigBody(bytes: number): string {
  return `<html><body>${"x".repeat(bytes)}</body></html>`;
}

async function routes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "/").split("?")[0] ?? "/";

  switch (path) {
    case "/page":
      html(res, page("Fixture page", ["/a", "/b"], '<meta name="description" content="A fixture.">'));
      return;
    case "/a":
      html(res, page("A"));
      return;
    case "/b":
      html(res, page("B"));
      return;
    case "/moved-once":
      redirect(res, "/page");
      return;
    case "/moved-twice":
      redirect(res, "/moved-once");
      return;
    case "/loop-1":
      redirect(res, "/loop-2");
      return;
    case "/loop-2":
      redirect(res, "/loop-1");
      return;
    case "/to-metadata":
      redirect(res, "http://169.254.169.254/latest/meta-data/");
      return;
    case "/to-file":
      redirect(res, "file:///etc/passwd");
      return;
    case "/to-credentials":
      redirect(res, `http://user:pass@${HOST}:${(req.socket.localPort ?? 0).toString()}/page`);
      return;
    case "/to-internal-name":
      redirect(res, "http://metadata.google.internal/computeMetadata/v1/");
      return;
    case "/to-private-ip":
      redirect(res, "http://10.0.0.5/admin");
      return;
    case "/image":
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    case "/no-content-type":
      res.writeHead(200, {});
      res.end("<html><title>No type</title></html>");
      return;
    case "/declared-huge":
      res.writeHead(200, { "content-type": "text/html", "content-length": "10485760" });
      res.end("<html><title>Huge</title></html>");
      return;
    case "/streamed-huge":
      res.writeHead(200, { "content-type": "text/html" });
      res.write(bigBody(64 * 1024));
      res.end(bigBody(64 * 1024));
      return;
    case "/never-answers":
      // Deliberately no response. The client must give up on its own.
      return;
    case "/slow-body":
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><body>");
      setTimeout(() => res.write("still here"), 400);
      setTimeout(() => res.end("</body></html>"), 800);
      return;
    case "/not-found":
      html(res, page("Missing"), 404);
      return;
    case "/redirect-chain/start":
      redirect(res, "/redirect-chain/1");
      return;
    default: {
      const chain = /^\/redirect-chain\/(\d+)$/.exec(path);
      if (chain !== null) {
        const step = Number(chain[1]);
        redirect(res, step >= 8 ? "/page" : `/redirect-chain/${step + 1}`);
        return;
      }
      html(res, page("Home"));
    }
  }
}

let server: FixtureServer;
let reachable: SafeFetchOptions;

const url = (path: string): string => `http://${HOST}:${server.port}${path}`;

beforeAll(async () => {
  server = await startFixtureServer(routes);
  reachable = {
    resolver: fixtureResolver(HOST),
    assertAddress: allowLoopback,
    // 80 is included so a redirect to a metadata address is refused by the address check rather
    // than incidentally by the port check. Both refusals have their own test.
    allowedPorts: [server.port, 80],
  };
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.reset();
});

const fastLimits: Partial<FetchLimits> = { hopTimeoutMs: 200, totalTimeoutMs: 600, connectTimeoutMs: 200 };

function withLimits(limits: Partial<FetchLimits>): SafeFetchOptions {
  return { ...reachable, limits: { ...fastLimits, ...limits } };
}

describe("the default policy", () => {
  it("refuses a loopback literal when only the port is allowed", async () => {
    // The port is granted and the address policy is the default: the refusal is the address.
    const result = await safeFetch(`http://127.0.0.1:${server.port}/page`, {
      allowedPorts: [server.port],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("blocked_address");
    expect(server.hits).toHaveLength(0);
  });

  it("refuses a hostname that resolves to loopback when no address policy is injected", async () => {
    const result = await safeFetch(`http://${HOST}:${server.port}/page`, {
      resolver: fixtureResolver(HOST),
      allowedPorts: [server.port],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("blocked_address");
    expect(server.hits).toHaveLength(0);
  });

  it("refuses a non-standard port when no port policy is injected", async () => {
    const result = await safeFetch(url("/page"), {
      resolver: fixtureResolver(HOST),
      assertAddress: allowLoopback,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsafe_target");
    expect(server.hits).toHaveLength(0);
  });
});

describe("address validation", () => {
  it("refuses when any DNS answer is private, even if another is public", async () => {
    const mixed: HostResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];

    const result = await safeFetch("http://mixed.example/", {
      resolver: mixed,
      assertAddress: allowLoopback,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("blocked_address");
      // The detail names the reason, never the address.
      expect(result.detail).not.toContain("93.184.216.34");
    }
    expect(server.hits).toHaveLength(0);
  });

  it.each([
    "169.254.169.254",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.20.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
  ])("refuses the literal address %s", async (address) => {
    const host = address.includes(":") ? `[${address}]` : address;
    const result = await safeFetch(`http://${host}/`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(["blocked_address", "unsafe_target"]).toContain(result.code);
  });

  it("refuses a hostname that only resolves when the resolver is asked twice (rebinding)", async () => {
    let calls = 0;
    const rebinding: HostResolver = async () => {
      calls += 1;
      return calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.5", family: 4 }];
    };

    const result = await safeFetch(url("/page"), {
      resolver: rebinding,
      assertAddress: allowLoopback,
      allowedPorts: [server.port],
    });

    // The connection is pinned to the validated answer, so a second answer never gets a chance.
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    expect(server.hits).toEqual(["/page"]);
  });
});

describe("redirects", () => {
  it("follows a short chain and reports where it ended", async () => {
    const result = await safeFetch(url("/moved-twice"), reachable);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.finalUrl).toBe(url("/page"));
      expect(result.redirects).toEqual([url("/moved-twice"), url("/moved-once")]);
    }
  });

  it("refuses a redirect to the cloud metadata address", async () => {
    const result = await safeFetch(url("/to-metadata"), reachable);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("blocked_address");
      expect(result.redirects).toEqual([url("/to-metadata")]);
    }
  });

  it("refuses a redirect to a private address", async () => {
    const result = await safeFetch(url("/to-private-ip"), reachable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("blocked_address");
  });

  it("refuses a redirect to an internal hostname", async () => {
    const result = await safeFetch(url("/to-internal-name"), reachable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("blocked_address");
  });

  it("refuses a redirect to a non-http scheme", async () => {
    const result = await safeFetch(url("/to-file"), reachable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported_scheme");
  });

  it("refuses a redirect that carries credentials", async () => {
    const result = await safeFetch(url("/to-credentials"), reachable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsafe_target");
  });

  it("detects a redirect loop", async () => {
    const result = await safeFetch(url("/loop-1"), reachable);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("redirect_loop");
  });

  it("refuses a redirect to a port outside the policy", async () => {
    const own = await startFixtureServer((req, res) => {
      if ((req.url ?? "/") === "/elsewhere") {
        redirect(res, `http://${HOST}:${own.port + 1}/page`);
        return;
      }
      html(res, "<html><title>start</title></html>");
    });

    try {
      const result = await safeFetch(`http://${HOST}:${own.port}/elsewhere`, {
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [own.port],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("unsafe_target");
    } finally {
      await own.close();
    }
  });

  it("stops at the redirect cap", async () => {
    const result = await safeFetch(url("/redirect-chain/start"), withLimits({ maxRedirects: 3 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("too_many_redirects");
      expect(result.redirects).toHaveLength(4);
    }
  });
});

describe("bounded responses", () => {
  it("refuses a body whose declared size is over the limit, without reading it", async () => {
    const result = await safeFetch(url("/declared-huge"), withLimits({ maxBytes: 64 * 1024 }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_large");
  });

  it("refuses a body that grows past the limit while streaming", async () => {
    const result = await safeFetch(url("/streamed-huge"), withLimits({ maxBytes: 64 * 1024 }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_large");
  });

  it("refuses anything that is not HTML", async () => {
    const image = await safeFetch(url("/image"), reachable);
    expect(image.ok).toBe(false);
    if (!image.ok) expect(image.code).toBe("non_html");

    const typeless = await safeFetch(url("/no-content-type"), reachable);
    expect(typeless.ok).toBe(false);
    if (!typeless.ok) expect(typeless.code).toBe("non_html");
  });

  it("gives up on a server that never answers", async () => {
    const started = Date.now();
    const result = await safeFetch(
      url("/never-answers"),
      withLimits({ hopTimeoutMs: 120, totalTimeoutMs: 500 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("gives up on a body that trickles in", async () => {
    const result = await safeFetch(url("/slow-body"), withLimits({ hopTimeoutMs: 150, totalTimeoutMs: 400 }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("timeout");
  });
});

describe("ordinary responses", () => {
  it("returns an HTML page with its status, size and timing", async () => {
    const result = await safeFetch(url("/page"), reachable);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("text/html");
      expect(result.body).toContain("Fixture page");
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.redirects).toEqual([]);
    }
  });

  it("treats 404 as a page, not as a transport failure", async () => {
    const result = await safeFetch(url("/not-found"), reachable);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe(404);
  });

  it("sends an identifiable user agent and no compression", async () => {
    let seen: IncomingMessage["headers"] = {};
    const own = await startFixtureServer((req, res) => {
      seen = req.headers;
      html(res, page("UA"));
    });

    try {
      await safeFetch(`http://${HOST}:${own.port}/`, {
        resolver: fixtureResolver(HOST),
        assertAddress: allowLoopback,
        allowedPorts: [own.port],
        userAgent: "SiteAuditBot/1.2 (+https://siteaudit.example/bot)",
      });
    } finally {
      await own.close();
    }

    expect(seen["user-agent"]).toBe("SiteAuditBot/1.2 (+https://siteaudit.example/bot)");
    expect(seen["accept-encoding"]).toBe("identity");
    expect(seen["cookie"]).toBeUndefined();
    expect(seen["authorization"]).toBeUndefined();
  });
});
