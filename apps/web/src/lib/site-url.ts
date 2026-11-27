/**
 * A browser-side sanity check for an address someone typed on the landing page.
 *
 * This is *not* the SSRF gate and must never be treated as one. `packages/validation` imports
 * `node:net` and `node:dns`, so it cannot run in a browser at all — and a client-side check
 * cannot resolve DNS anyway. Its only jobs are to catch obvious typos before someone leaves the
 * page, and to be honest about what it cannot know:
 *
 *   - scheme must be http or https,
 *   - no username or password in the address,
 *   - a hostname must be present.
 *
 * The server re-validates everything, including whether the host resolves to a public address.
 */

const MAX_LENGTH = 2048;

export type SiteAddressCheck = { ok: true; href: string } | { ok: false; message: string };

export function checkSiteAddress(raw: string): SiteAddressCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, message: "Enter the address you want audited." };
  if (trimmed.length > MAX_LENGTH) return { ok: false, message: "That address is too long to use." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "Include the full address, starting with https://" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Only http and https addresses can be audited." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "Remove the username and password from the address." };
  }
  if (url.hostname === "") {
    return { ok: false, message: "That address has no website in it." };
  }

  return { ok: true, href: url.href };
}
