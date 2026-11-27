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
export declare const MAX_URL_LENGTH = 2048;
export declare const ALLOWED_PROTOCOLS: readonly ["http:", "https:"];
export type AllowedProtocol = (typeof ALLOWED_PROTOCOLS)[number];
export declare const ALLOWED_PORTS: readonly [80, 443];
export type UnsafeReason = "empty" | "too-long" | "malformed" | "protocol-not-allowed" | "credentials-in-url" | "missing-hostname" | "port-not-allowed" | "hostname-not-public" | "address-not-public" | "dns-failed" | "dns-not-public";
export declare function publicMessageFor(reason: UnsafeReason): string;
export declare class UnsafeTargetError extends Error {
    readonly reason: UnsafeReason;
    readonly detail: string;
    constructor(reason: UnsafeReason, detail: string);
}
/** True when the literal address must not be fetched. Unparseable input is treated as
 *  blocked: an address we cannot classify is an address we do not touch. */
export declare function isBlockedAddress(address: string): boolean;
export declare function assertPublicAddress(address: string): void;
export declare function assertPublicHostname(hostname: string): void;
/**
 * Syntactic gate: scheme, credentials, port, hostname shape, and — when the URL uses an
 * IP literal — the address itself. No network access, so it is safe to call inline.
 */
export declare function parseTargetUrl(raw: unknown): URL;
export interface ResolvedAddress {
    address: string;
    family: number;
}
export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;
/**
 * Every DNS answer is validated, not just the first: a name that resolves to one public
 * and one private address is a private address.
 *
 * The returned addresses are what the caller must connect to. Resolving again at connect
 * time is how DNS rebinding defeats a check like this one.
 */
export declare function resolveValidatedAddresses(hostname: string, resolver?: HostResolver): Promise<ReadonlyArray<ResolvedAddress>>;
export interface AssertSafeTargetOptions {
    resolver?: HostResolver;
}
export interface SafeTarget {
    url: URL;
    /** Connect to one of these, never re-resolve. */
    addresses: ReadonlyArray<ResolvedAddress>;
}
export declare function assertSafeTarget(raw: unknown, options?: AssertSafeTargetOptions): Promise<SafeTarget>;
//# sourceMappingURL=target-url.d.ts.map