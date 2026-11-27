/**
 * The only code in this system that talks to a third-party website (TRD §7, ARD §9).
 *
 * Four rules make it usable:
 *
 *  1. **Validate every hop.** The start URL and every `Location` go through `parseTargetUrl`
 *     (scheme, credentials, port, hostname) and then a DNS resolution whose *every* answer is
 *     checked. A redirect to a private address is refused exactly like a first hop would be.
 *  2. **Pin the connection.** The address we validated is the address the socket connects to:
 *     `lookup` is replaced with a function that ignores DNS and returns the checked answer. A
 *     DNS server that changes its mind between our check and the connection therefore changes
 *     nothing. This closes the classic rebinding window for the request itself; the residual
 *     risk (a proxy, or a CNAME whose target we never re-resolve) is written down in
 *     `docs/CRAWLER.md`.
 *  3. **Bound everything a server controls.** Bytes, redirects, per-hop time and total time are
 *     enforced by destroying the socket, not by trusting `Content-Length`.
 *  4. **Fail closed with a code.** Every refusal is one of the codes in `FetchFailureCode`, and
 *     the detail is for logs only — it can contain an address, and this string is never rendered.
 */

import { lookup } from "node:dns/promises";
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";

import {
  UnsafeTargetError,
  assertPublicAddress,
  parseTargetUrl,
  type HostResolver,
  type ResolvedAddress,
} from "@siteaudit/validation";

import { DEFAULT_FETCH_LIMITS, DEFAULT_USER_AGENT, requestHeaders, type FetchLimits } from "./limits.js";

export type FetchFailureCode =
  | "unsafe_target"
  | "blocked_address"
  | "unsupported_scheme"
  | "dns_failed"
  | "connection_failed"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "redirect_loop"
  | "non_html"
  | "aborted";

export interface FetchSuccess {
  readonly ok: true;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly contentType: string;
  /** Where the content actually came from, after redirects. */
  readonly finalUrl: string;
  readonly requestedUrl: string;
  readonly redirects: readonly string[];
  readonly durationMs: number;
  readonly byteSize: number;
}

export interface FetchFailure {
  readonly ok: false;
  readonly code: FetchFailureCode;
  readonly requestedUrl: string;
  readonly url: string;
  readonly redirects: readonly string[];
  readonly durationMs: number;
  /** For logs. Never rendered, never stored: it can name an address. */
  readonly detail: string;
}

export type FetchResult = FetchSuccess | FetchFailure;

export interface SafeFetchOptions {
  readonly limits?: Partial<FetchLimits>;
  /** Injected in tests. Defaults to the system resolver. */
  readonly resolver?: HostResolver;
  /**
   * Address policy applied to *every* resolved answer. Defaults to `assertPublicAddress`, which
   * refuses loopback, private, link-local, multicast, reserved and metadata ranges.
   *
   * This hook exists so the crawler's own tests can reach a fixture server on 127.0.0.1. A test
   * proves the default refuses loopback, so the hook cannot hide a broken default.
   */
  readonly assertAddress?: (address: string) => void;
  /**
   * Ports this fetch may use. Defaults to 80 and 443 (`ALLOWED_PORTS`). Tests point it at a
   * fixture server's ephemeral port; nothing in the API or the worker sets it.
   */
  readonly allowedPorts?: readonly number[];
  readonly userAgent?: string;
  readonly signal?: AbortSignal;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function headerRecord(headers: IncomingHttpHeaders): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    record[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return record;
}

function contentKind(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function resolveHost(hostname: string, resolver?: HostResolver): Promise<ResolvedAddress[]> {
  const bare = stripBrackets(hostname);
  const literalFamily = isIP(bare);
  if (literalFamily !== 0) return [{ address: bare, family: literalFamily }];

  try {
    const answers =
      resolver === undefined ? await lookup(bare, { all: true, verbatim: true }) : await resolver(bare);
    if (answers.length === 0) throw new UnsafeTargetError("dns-failed", "no addresses");
    return answers.map((answer) => ({ address: answer.address, family: answer.family }));
  } catch (error) {
    if (error instanceof UnsafeTargetError) throw error;
    throw new UnsafeTargetError("dns-failed", "lookup failed");
  }
}

/**
 * The only address the socket may use for this hop. DNS is not consulted a second time, which is
 * what makes a rebinding resolver useless between the check and the connection.
 */
function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    // Node passes `all: true` when `autoSelectFamily` is on (the default since Node 20).
    if (options.all === true) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

type HopOutcome =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly body: string;
      readonly byteSize: number;
    }
  | { readonly kind: "redirect"; readonly status: number; readonly location: string }
  | { readonly kind: "failure"; readonly code: FetchFailureCode; readonly detail: string };

function requestOnce(
  url: URL,
  pinned: ResolvedAddress,
  limits: FetchLimits,
  deadline: number,
  userAgent: string,
  signal: AbortSignal | undefined,
): Promise<HopOutcome> {
  return new Promise<HopOutcome>((resolve) => {
    const isHttps = url.protocol === "https:";
    const hostname = stripBrackets(url.hostname);
    const port = url.port === "" ? (isHttps ? 443 : 80) : Number(url.port);
    const budget = Math.max(1, Math.min(limits.hopTimeoutMs, deadline - Date.now()));

    let settled = false;
    let request: ClientRequest | null = null;

    const finish = (outcome: HopOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const abortWith = (code: FetchFailureCode, detail: string): void => {
      finish({ kind: "failure", code, detail });
      request?.destroy();
    };

    const options = {
      protocol: url.protocol,
      hostname,
      port,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: requestHeaders(userAgent),
      lookup: pinnedLookup(pinned.address, pinned.family),
      ...(isHttps
        ? {
            // Keep certificate and SNI semantics tied to the name the user asked for, not the
            // address we connected to.
            servername: hostname,
            checkServerIdentity: (_host: string, certificate: PeerCertificate) =>
              checkServerIdentity(hostname, certificate),
          }
        : {}),
    };

    try {
      request = isHttps ? httpsRequest(options) : httpRequest(options);
    } catch (error) {
      finish({
        kind: "failure",
        code: "connection_failed",
        detail: error instanceof Error ? error.message : "request failed",
      });
      return;
    }

    // One timer for the whole hop. Nothing a server does resets it.
    const timer = setTimeout(() => abortWith("timeout", `no complete response within ${budget} ms`), budget);
    const onAbort = (): void => abortWith("aborted", "the crawl was stopped");
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    request.setTimeout(budget, () => abortWith("timeout", "socket idle"));
    request.on("error", (error: Error & { code?: string }) => {
      cleanup();
      finish({
        kind: "failure",
        code: error.code === "ETIMEDOUT" ? "timeout" : "connection_failed",
        detail: error.code ?? error.message,
      });
    });

    request.on("response", (response) => {
      const headers = headerRecord(response.headers);
      const status = response.statusCode ?? 0;

      if (REDIRECT_STATUSES.has(status)) {
        cleanup();
        const location = headers["location"];
        response.destroy();
        if (location === undefined || location === "") {
          finish({ kind: "response", status, headers, body: "", byteSize: 0 });
          return;
        }
        finish({ kind: "redirect", status, location });
        return;
      }

      const declared = Number(headers["content-length"] ?? "");
      if (Number.isFinite(declared) && declared > limits.maxBytes) {
        cleanup();
        response.destroy();
        finish({ kind: "failure", code: "too_large", detail: `content-length ${declared}` });
        return;
      }

      const kind = contentKind(headers["content-type"]);
      if (!limits.allowedContentTypes.includes(kind)) {
        cleanup();
        response.destroy();
        finish({
          kind: "failure",
          code: "non_html",
          detail: `content-type ${kind === "" ? "absent" : kind}`,
        });
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;

      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > limits.maxBytes) {
          cleanup();
          abortWith("too_large", `more than ${limits.maxBytes} bytes`);
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        cleanup();
        finish({
          kind: "response",
          status,
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
          byteSize: total,
        });
      });

      response.on("error", () => {
        cleanup();
        finish({ kind: "failure", code: "connection_failed", detail: "response stream failed" });
      });
    });

    request.end();
  });
}

function classifyTargetError(error: unknown): { code: FetchFailureCode; detail: string } {
  if (error instanceof UnsafeTargetError) {
    switch (error.reason) {
      case "dns-failed":
        return { code: "dns_failed", detail: error.detail };
      case "dns-not-public":
      case "address-not-public":
      case "hostname-not-public":
        return { code: "blocked_address", detail: error.reason };
      case "protocol-not-allowed":
        return { code: "unsupported_scheme", detail: error.reason };
      default:
        return { code: "unsafe_target", detail: error.reason };
    }
  }
  return { code: "unsafe_target", detail: error instanceof Error ? error.name : "unknown" };
}

/**
 * Fetch one HTML page under the crawler's policy.
 *
 * Returns a result rather than throwing: a refused target, a timeout and a 404 are all normal
 * outcomes of crawling, and the caller records them.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const limits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, ...options.limits };
  const assertAddress = options.assertAddress ?? assertPublicAddress;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const startedAt = Date.now();
  const deadline = startedAt + limits.totalTimeoutMs;
  const redirects: string[] = [];
  const visited = new Set<string>();

  const fail = (code: FetchFailureCode, detail: string, url: string): FetchFailure => ({
    ok: false,
    code,
    requestedUrl: rawUrl,
    url,
    redirects: [...redirects],
    durationMs: Date.now() - startedAt,
    detail,
  });

  let current = rawUrl;

  // `<=` because a chain of exactly `maxRedirects` hops is allowed: N redirects then a document.
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    if (Date.now() >= deadline) return fail("timeout", "total budget spent", current);

    let url: URL;
    try {
      url =
        options.allowedPorts === undefined
          ? parseTargetUrl(current)
          : parseTargetUrl(current, { allowedPorts: options.allowedPorts });
    } catch (error) {
      const { code, detail } = classifyTargetError(error);
      return fail(code, detail, current);
    }

    if (visited.has(url.href)) return fail("redirect_loop", `revisited ${url.host}`, url.href);
    visited.add(url.href);
    if (url.href.length > limits.maxUrlLength) return fail("unsafe_target", "url too long", url.href);

    let answers: ResolvedAddress[];
    try {
      answers = await resolveHost(url.hostname, options.resolver);
      for (const answer of answers) assertAddress(answer.address);
    } catch (error) {
      const { code, detail } = classifyTargetError(error);
      return fail(code, detail, url.href);
    }

    const pinned = answers[0];
    if (pinned === undefined) return fail("dns_failed", "no addresses", url.href);

    const outcome = await requestOnce(url, pinned, limits, deadline, userAgent, options.signal);

    if (outcome.kind === "failure") return fail(outcome.code, outcome.detail, url.href);

    if (outcome.kind === "redirect") {
      redirects.push(url.href);
      let next: URL;
      try {
        next = new URL(outcome.location, url);
      } catch {
        return fail("unsafe_target", "unparseable Location", url.href);
      }
      if (redirects.length > limits.maxRedirects) {
        return fail("too_many_redirects", `more than ${limits.maxRedirects}`, url.href);
      }
      current = next.href;
      continue;
    }

    return {
      ok: true,
      status: outcome.status,
      headers: outcome.headers,
      body: outcome.body,
      contentType: contentKind(outcome.headers["content-type"]),
      finalUrl: url.href,
      requestedUrl: rawUrl,
      redirects: [...redirects],
      durationMs: Date.now() - startedAt,
      byteSize: outcome.byteSize,
    };
  }

  return fail("too_many_redirects", `more than ${limits.maxRedirects}`, current);
}
