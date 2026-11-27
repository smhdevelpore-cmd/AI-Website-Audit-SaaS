/**
 * Target URL safety (SSRF gate).
 *
 * Every outbound fetch in this system goes through this module first. It answers one
 * question: is this URL a public HTTP(S) resource we are allowed to touch?
 *
 * Rules are deterministic and testable (ADR-006, TRD §7). Nothing here guesses: an
 * address is either provably public or it is rejected.
 *
 * NOT covered here, and required before the crawler ships:
 *  - pinning the connection to a validated IP (DNS rebinding happens between our
 *    resolve and the socket) — the caller must use `addresses` from assertSafeTarget,
 *  - revalidating each redirect hop,
 *  - timeouts, response byte limits, concurrency limits.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export const MAX_URL_LENGTH = 2048;

export const ALLOWED_PROTOCOLS = ["http:", "https:"] as const;
export type AllowedProtocol = (typeof ALLOWED_PROTOCOLS)[number];

export const ALLOWED_PORTS = [80, 443] as const;

export type UnsafeReason =
  | "empty"
  | "too-long"
  | "malformed"
  | "protocol-not-allowed"
  | "credentials-in-url"
  | "missing-hostname"
  | "port-not-allowed"
  | "hostname-not-public"
  | "address-not-public"
  | "dns-failed"
  | "dns-not-public";

/**
 * What a client is allowed to see. Never includes the resolved address or the host's
 * internals: that would turn a rejection into a port scanner.
 */
const PUBLIC_MESSAGES: Record<UnsafeReason, string> = {
  empty: "Enter the address of the page you want audited.",
  "too-long": "That address is too long to audit.",
  malformed: "That does not look like a web address. Try https://example.com.",
  "protocol-not-allowed": "Only http and https addresses can be audited.",
  "credentials-in-url": "Remove the username and password from the address.",
  "missing-hostname": "That address has no domain name in it.",
  "port-not-allowed": "Only the standard web ports can be audited.",
  "hostname-not-public": "That address is not a public website we can reach.",
  "address-not-public": "That address is not a public website we can reach.",
  "dns-failed": "That domain did not resolve. Check the spelling and try again.",
  "dns-not-public": "That domain resolves to an address that is not a public website.",
};

export function publicMessageFor(reason: UnsafeReason): string {
  return PUBLIC_MESSAGES[reason];
}

export class UnsafeTargetError extends Error {
  readonly reason: UnsafeReason;
  readonly detail: string;

  constructor(reason: UnsafeReason, detail: string) {
    super(`Unsafe target (${reason}): ${detail}`);
    this.name = "UnsafeTargetError";
    this.reason = reason;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ IPv4 */

function parseIPv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }

  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

function ipv4ToInt([a, b, c, d]: readonly [number, number, number, number]): number {
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

/** Ranges that must never be reachable. Includes cloud metadata (169.254.0.0/16,
 *  192.0.0.0/24, 100.64.0.0/10 via CGNAT) and every documented/reserved block. */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_IPV4_NETWORKS = BLOCKED_IPV4.map(([network, prefix]) => {
  const parsed = parseIPv4(network);
  if (parsed === null) throw new Error(`invalid CIDR in blocklist: ${network}`);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (ipv4ToInt(parsed) & mask) >>> 0, mask };
});

function isBlockedIPv4(octets: readonly [number, number, number, number]): boolean {
  const value = ipv4ToInt(octets);
  return BLOCKED_IPV4_NETWORKS.some(({ base, mask }) => (value & mask) >>> 0 === base);
}

/* ------------------------------------------------------------------ IPv6 */

function parseIPv6(input: string): Uint8Array | null {
  let host = input;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "" || host.includes("%")) return null; // zone ids are link-scoped
  if (!/^[0-9a-fA-F:.]+$/.test(host)) return null;

  // Fold a dotted-quad tail (::ffff:127.0.0.1) into two hex groups.
  let normalised = host;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted !== null) {
    const octets = parseIPv4(dotted[2] ?? "");
    if (octets === null) return null;
    const [a, b, c, d] = octets;
    normalised = `${dotted[1] ?? ""}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = normalised.split("::");
  if (halves.length > 2) return null;

  const headText = halves[0] ?? "";
  const tailText = halves[1] ?? "";
  const head = headText === "" ? [] : headText.split(":");
  const tail = halves.length === 2 && tailText !== "" ? tailText.split(":") : [];

  const groups: number[] = [];
  for (const group of [...head, ...tail]) {
    if (group.length === 0 || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }

  let full: number[];
  if (halves.length === 2) {
    const missing = 8 - groups.length;
    if (missing < 1) return null;
    full = [
      ...groups.slice(0, head.length),
      ...new Array<number>(missing).fill(0),
      ...groups.slice(head.length),
    ];
  } else {
    if (groups.length !== 8) return null;
    full = groups;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const group = full[i] ?? 0;
    bytes[i * 2] = (group >> 8) & 0xff;
    bytes[i * 2 + 1] = group & 0xff;
  }
  return bytes;
}

function isBlockedIPv6(bytes: Uint8Array): boolean {
  const byte = (i: number): number => bytes[i] ?? 0;
  const zeroPrefix = (length: number): boolean => {
    for (let i = 0; i < length; i += 1) if (byte(i) !== 0) return false;
    return true;
  };
  const embedded = (offset: number): readonly [number, number, number, number] => [
    byte(offset),
    byte(offset + 1),
    byte(offset + 2),
    byte(offset + 3),
  ];

  if (zeroPrefix(16)) return true; // ::
  if (zeroPrefix(15) && byte(15) === 1) return true; // ::1
  if ((byte(0) & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (byte(0) === 0xfe && (byte(1) & 0xc0) === 0x80) return true; // fe80::/10 link local
  if (byte(0) === 0xff) return true; // ff00::/8 multicast

  const isDocumentation = byte(0) === 0x20 && byte(1) === 0x01 && byte(2) === 0x0d && byte(3) === 0xb8;
  if (isDocumentation) return true; // 2001:db8::/32

  const isTeredo = byte(0) === 0x20 && byte(1) === 0x01 && byte(2) === 0x00 && byte(3) === 0x00;
  if (isTeredo) return true; // 2001::/32 tunnels an arbitrary IPv4

  if (byte(0) === 0x20 && byte(1) === 0x02) return isBlockedIPv4(embedded(2)); // 6to4

  if (zeroPrefix(10) && byte(10) === 0xff && byte(11) === 0xff) return isBlockedIPv4(embedded(12)); // ::ffff:0:0/96

  if (zeroPrefix(12)) return isBlockedIPv4(embedded(12)); // deprecated ::a.b.c.d

  const isNat64 = byte(0) === 0x00 && byte(1) === 0x64 && byte(2) === 0xff && byte(3) === 0x9b;
  if (isNat64) return isBlockedIPv4(embedded(12)); // 64:ff9b::/96

  // Anything outside global unicast 2000::/3 is not a public website address.
  return (byte(0) & 0xe0) !== 0x20;
}

/* -------------------------------------------------------------- addresses */

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** True when the literal address must not be fetched. Unparseable input is treated as
 *  blocked: an address we cannot classify is an address we do not touch. */
export function isBlockedAddress(address: string): boolean {
  const bare = stripBrackets(address);
  const v4 = parseIPv4(bare);
  if (v4 !== null) return isBlockedIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6 !== null) return isBlockedIPv6(v6);
  return true;
}

export function assertPublicAddress(address: string): void {
  if (isBlockedAddress(address)) {
    throw new UnsafeTargetError("address-not-public", "literal address is not public");
  }
}

/* -------------------------------------------------------------- hostnames */

/** Names that only ever resolve inside a network. Checked before any DNS lookup. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata",
  "instance-data",
  "metadata.google.internal",
]);

const BLOCKED_HOST_SUFFIXES: readonly string[] = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home.arpa",
  ".lan",
  ".intranet",
  ".corp",
];

export function assertPublicHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "") {
    throw new UnsafeTargetError("missing-hostname", "empty hostname");
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeTargetError("hostname-not-public", "internal hostname");
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeTargetError("hostname-not-public", "internal hostname suffix");
  }
  const bare = stripBrackets(host);
  if (isIP(bare) === 0 && !host.includes(".")) {
    throw new UnsafeTargetError("hostname-not-public", "single-label hostname");
  }
}

/* --------------------------------------------------------------- parsing */

export interface ParseTargetUrlOptions {
  /**
   * Ports a fetch may use. Defaults to `ALLOWED_PORTS` (80 and 443, TRD §7).
   *
   * The override exists for one reason: a test fixture server cannot bind a privileged port, and
   * a crawler test that cannot reach a local server would prove nothing. Nothing in the API or the
   * worker passes it; the crawler's tests do, and a unit test asserts the default still refuses
   * port 8080.
   */
  readonly allowedPorts?: readonly number[];
}

/**
 * Syntactic gate: scheme, credentials, port, hostname shape, and — when the URL uses an
 * IP literal — the address itself. No network access, so it is safe to call inline.
 */
export function parseTargetUrl(raw: unknown, options: ParseTargetUrlOptions = {}): URL {
  if (typeof raw !== "string") {
    throw new UnsafeTargetError("malformed", "not a string");
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new UnsafeTargetError("empty", "blank");
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new UnsafeTargetError("too-long", `${trimmed.length} characters`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeTargetError("malformed", "unparseable");
  }

  const protocol = url.protocol.toLowerCase();
  if (!(ALLOWED_PROTOCOLS as readonly string[]).includes(protocol)) {
    throw new UnsafeTargetError("protocol-not-allowed", protocol);
  }
  if (url.username !== "" || url.password !== "") {
    throw new UnsafeTargetError("credentials-in-url", "userinfo present");
  }
  if (url.hostname === "") {
    throw new UnsafeTargetError("missing-hostname", "no host");
  }

  const port = url.port === "" ? (protocol === "https:" ? 443 : 80) : Number(url.port);
  const allowedPorts = options.allowedPorts ?? ALLOWED_PORTS;
  if (!allowedPorts.includes(port)) {
    throw new UnsafeTargetError("port-not-allowed", String(port));
  }

  assertPublicHostname(url.hostname);

  const bare = stripBrackets(url.hostname);
  if (isIP(bare) !== 0) assertPublicAddress(bare);

  return url;
}

/* -------------------------------------------------------------------- DNS */

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

const systemResolver: HostResolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Every DNS answer is validated, not just the first: a name that resolves to one public
 * and one private address is a private address.
 *
 * The returned addresses are what the caller must connect to. Resolving again at connect
 * time is how DNS rebinding defeats a check like this one.
 */
export async function resolveValidatedAddresses(
  hostname: string,
  resolver: HostResolver = systemResolver,
): Promise<ReadonlyArray<ResolvedAddress>> {
  let answers: ReadonlyArray<ResolvedAddress>;
  try {
    answers = await resolver(hostname);
  } catch {
    throw new UnsafeTargetError("dns-failed", "lookup failed");
  }
  if (answers.length === 0) {
    throw new UnsafeTargetError("dns-failed", "no addresses");
  }
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) {
      throw new UnsafeTargetError("dns-not-public", "resolved address is not public");
    }
  }
  return answers;
}

export interface AssertSafeTargetOptions {
  resolver?: HostResolver;
  /** See `ParseTargetUrlOptions.allowedPorts`. Defaults to 80 and 443. */
  allowedPorts?: readonly number[];
}

export interface SafeTarget {
  url: URL;
  /** Connect to one of these, never re-resolve. */
  addresses: ReadonlyArray<ResolvedAddress>;
}

export async function assertSafeTarget(
  raw: unknown,
  options: AssertSafeTargetOptions = {},
): Promise<SafeTarget> {
  const url =
    options.allowedPorts === undefined
      ? parseTargetUrl(raw)
      : parseTargetUrl(raw, { allowedPorts: options.allowedPorts });
  const bare = stripBrackets(url.hostname);

  const literalFamily = isIP(bare);
  if (literalFamily !== 0) {
    return { url, addresses: [{ address: bare, family: literalFamily }] };
  }

  const resolver = options.resolver ?? systemResolver;
  const addresses = await resolveValidatedAddresses(bare, resolver);
  return { url, addresses };
}
