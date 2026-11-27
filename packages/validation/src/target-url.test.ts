import { describe, expect, it } from "vitest";
import {
  UnsafeTargetError,
  assertSafeTarget,
  isBlockedAddress,
  parseTargetUrl,
  type HostResolver,
  type UnsafeReason,
} from "./target-url.js";

function reasonOf(fn: () => unknown): UnsafeReason | "no-error" {
  try {
    fn();
  } catch (error) {
    if (error instanceof UnsafeTargetError) return error.reason;
    throw error;
  }
  return "no-error";
}

async function asyncReasonOf(fn: () => Promise<unknown>): Promise<UnsafeReason | "no-error"> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof UnsafeTargetError) return error.reason;
    throw error;
  }
  return "no-error";
}

const resolverOf =
  (addresses: ReadonlyArray<{ address: string; family: number }>): HostResolver =>
  async () =>
    addresses;

const throwingResolver: HostResolver = async () => {
  throw new Error("ENOTFOUND");
};

describe("accepts ordinary public web addresses", () => {
  const accepted = [
    "https://example.com",
    "http://example.com",
    "https://example.com/path/to/page?q=1#section",
    "HTTPS://EXAMPLE.COM",
    "https://example.com:443/",
    "http://example.com:80/",
    "https://sub.example.co.uk./",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/",
    "https://example.com/ünïcode/path",
  ];

  for (const input of accepted) {
    it(input, () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("no-error");
    });
  }
});

describe("rejects malformed input", () => {
  const cases: ReadonlyArray<readonly [string, UnsafeReason]> = [
    ["", "empty"],
    ["    ", "empty"],
    ["example.com", "malformed"],
    ["http://", "malformed"],
    [`https://${"a".repeat(2100)}.com`, "too-long"],
  ];

  for (const [input, expected] of cases) {
    it(JSON.stringify(input.slice(0, 40)), () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe(expected);
    });
  }

  it("rejects a non-string", () => {
    expect(reasonOf(() => parseTargetUrl(42))).toBe("malformed");
  });
});

describe("rejects non-HTTP schemes and credentials", () => {
  const cases: ReadonlyArray<readonly [string, UnsafeReason]> = [
    ["ftp://example.com/file", "protocol-not-allowed"],
    ["file:///etc/passwd", "protocol-not-allowed"],
    ["javascript:alert(1)", "protocol-not-allowed"],
    ["data:text/html,<script>alert(1)</script>", "protocol-not-allowed"],
    ["gopher://example.com", "protocol-not-allowed"],
    ["https://user:secret@example.com/", "credentials-in-url"],
    ["https://user@example.com/", "credentials-in-url"],
  ];

  for (const [input, expected] of cases) {
    it(input, () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe(expected);
    });
  }
});

describe("rejects internal hostnames", () => {
  const cases = [
    "http://localhost/",
    "http://LOCALHOST./",
    "http://api.localhost/",
    "http://metadata/",
    "http://instance-data/",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "http://build.internal/",
    "http://router.home.arpa/",
    "http://intranet/",
  ];

  for (const input of cases) {
    it(input, () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("hostname-not-public");
    });
  }
});

describe("rejects IPv4 addresses that are not public", () => {
  const cases = [
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://169.254.169.254/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.0.0.192/",
    "http://192.168.1.1/",
    "http://100.100.100.200/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://240.0.0.1/",
    "http://255.255.255.255/",
  ];

  for (const input of cases) {
    it(input, () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("address-not-public");
    });
  }

  it("accepts the public neighbours of blocked blocks", () => {
    for (const input of [
      "http://172.32.0.1/",
      "http://11.0.0.1/",
      "http://192.169.0.1/",
      "http://223.255.255.254/",
    ]) {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("no-error");
    }
  });

  it("catches the numeric spellings a browser normalises to 127.0.0.1", () => {
    for (const input of ["http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/"]) {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("address-not-public");
    }
  });
});

describe("rejects IPv6 addresses that are not public", () => {
  const cases = [
    "http://[::]/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[2001:db8::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[2001:0:0:0:0:0:0:1]/",
  ];

  for (const input of cases) {
    it(input, () => {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("address-not-public");
    });
  }

  it("accepts global unicast, including a 6to4 tunnel that wraps a public IPv4", () => {
    for (const input of ["http://[2a00:1450:4001:80f::200e]/", "http://[2002:0808:0808::1]/"]) {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("no-error");
    }
  });
});

describe("restricts ports", () => {
  it("rejects everything but 80 and 443", () => {
    for (const input of [
      "http://example.com:8080/",
      "http://example.com:22/",
      "http://example.com:3000/",
      "https://example.com:8443/",
      "http://example.com:6379/",
    ]) {
      expect(reasonOf(() => parseTargetUrl(input))).toBe("port-not-allowed");
    }
  });
});

describe("isBlockedAddress classifies raw addresses", () => {
  it("blocks, including unparseable input", () => {
    for (const address of ["127.0.0.1", "::1", "169.254.169.254", "fd00:ec2::254", "not-an-address", ""]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80f::200e"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });
});

describe("assertSafeTarget validates every DNS answer", () => {
  it("returns the addresses to connect to", async () => {
    const result = await assertSafeTarget("https://example.com", {
      resolver: resolverOf([{ address: "93.184.215.14", family: 4 }]),
    });

    expect(result.url.hostname).toBe("example.com");
    expect(result.addresses).toEqual([{ address: "93.184.215.14", family: 4 }]);
  });

  it("rejects a name that resolves to one public and one private address", async () => {
    const reason = await asyncReasonOf(() =>
      assertSafeTarget("https://example.com", {
        resolver: resolverOf([
          { address: "93.184.215.14", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ]),
      }),
    );

    expect(reason).toBe("dns-not-public");
  });

  it("rejects a name that resolves to a private IPv6 answer", async () => {
    const reason = await asyncReasonOf(() =>
      assertSafeTarget("https://example.com", {
        resolver: resolverOf([{ address: "fd00::1", family: 6 }]),
      }),
    );

    expect(reason).toBe("dns-not-public");
  });

  it("rejects an empty answer set and a failing lookup", async () => {
    expect(
      await asyncReasonOf(() => assertSafeTarget("https://example.com", { resolver: resolverOf([]) })),
    ).toBe("dns-failed");
    expect(
      await asyncReasonOf(() => assertSafeTarget("https://example.com", { resolver: throwingResolver })),
    ).toBe("dns-failed");
  });

  it("does not resolve a literal address, so a literal cannot be rebound", async () => {
    let called = false;
    const spy: HostResolver = async () => {
      called = true;
      return [{ address: "8.8.8.8", family: 4 }];
    };

    const result = await assertSafeTarget("https://8.8.8.8/", { resolver: spy });

    expect(called).toBe(false);
    expect(result.addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("rejects before resolving when the syntax is already unsafe", async () => {
    let called = false;
    const spy: HostResolver = async () => {
      called = true;
      return [{ address: "8.8.8.8", family: 4 }];
    };

    expect(await asyncReasonOf(() => assertSafeTarget("http://example.com:8080/", { resolver: spy }))).toBe(
      "port-not-allowed",
    );
    expect(called).toBe(false);
  });
});
