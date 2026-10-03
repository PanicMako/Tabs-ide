import * as NodeCrypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  fromPartition: vi.fn(() => ({
    cookies: {
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      flushStore: vi.fn().mockResolvedValue(undefined),
    },
  })),
}));

vi.mock("electron", () => ({
  session: {
    fromPartition: electronMocks.fromPartition,
  },
}));

import { BrowserSessionImporter, importSyntheticCookiesToSession } from "./BrowserSessionImporter";
import { decryptChromiumValue, readChromiumCookies } from "./ChromiumCookies";
import { deriveKey } from "./ChromiumKeys";
import { bareHost, cookieScope, snapshotCookieDatabase } from "./CookieDatabase";
import { readFirefoxCookies } from "./FirefoxCookies";
import { parseBinaryCookies } from "./SafariCookies";

describe("BrowserSessionImporter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await FS.mkdtemp(Path.join(Os.tmpdir(), "tabs-import-test-"));
  });

  afterEach(async () => {
    try {
      await FS.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("detects running browser and flags unavailable as browserRunning", async () => {
    const mockRunningFn = vi.fn().mockResolvedValue(true);
    const importer = new BrowserSessionImporter("darwin", mockRunningFn);

    const chromeDir = Path.join(Os.homedir(), "Library/Application Support/Google/Chrome");
    let hasChrome = false;
    try {
      const stat = await FS.stat(chromeDir);
      hasChrome = stat.isDirectory();
    } catch {
      hasChrome = false;
    }

    if (hasChrome) {
      const sources = await importer.listSources();
      const chromeSource = sources.find((s) => s.id === "chrome");
      if (chromeSource) {
        expect(chromeSource.unavailable).toBe("browserRunning");
      }
    }
  });

  it("refuses to import if browser is currently running", async () => {
    const mockRunningFn = vi.fn().mockResolvedValue(true);
    const importer = new BrowserSessionImporter("darwin", mockRunningFn);

    await expect(
      importer.importSelectedCookies({
        sourceId: "chrome",
        sourceProfileDirectory: "Default",
        targetProfileId: "imported-chrome",
      }),
    ).rejects.toThrow("Please quit the browser first");
  });

  it("rejects unknown profile directories instead of allowing path traversal", async () => {
    const mockRunningFn = vi.fn().mockResolvedValue(false);
    const importer = new BrowserSessionImporter("darwin", mockRunningFn);

    await expect(
      importer.importSelectedCookies({
        sourceId: "chrome",
        sourceProfileDirectory: "../../../../etc",
        targetProfileId: "imported-chrome",
      }),
    ).rejects.toThrow("Selected browser profile was not found");
    expect(electronMocks.fromPartition).not.toHaveBeenCalled();
  });

  it("successfully imports cookies into target session using real-browser importer engine", async () => {
    const mockRunningFn = vi.fn().mockResolvedValue(false);

    // Create a mock Chromium profile directory with a Cookies database
    const fakeUserData = Path.join(tempDir, "ChromeUserData");
    const fakeProfileDir = Path.join(fakeUserData, "Default");
    const fakeNetworkDir = Path.join(fakeProfileDir, "Network");
    await FS.mkdir(fakeNetworkDir, { recursive: true });

    const importer = new BrowserSessionImporter(
      "darwin",
      mockRunningFn,
      { chrome: fakeUserData },
      { chrome: { cbcV10: Buffer.alloc(16) } },
    );

    const cookieDbPath = Path.join(fakeNetworkDir, "Cookies");
    const db = new DatabaseSync(cookieDbPath);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('version', '23');
      CREATE TABLE cookies (
        host_key TEXT,
        name TEXT,
        value TEXT,
        encrypted_value BLOB,
        path TEXT,
        expires_utc INTEGER,
        is_secure INTEGER,
        is_httponly INTEGER,
        samesite INTEGER,
        top_frame_site_key TEXT
      );
    `);
    const webkitExpiry = (2208988800 + 11644473600) * 1000000;
    const stmt = db.prepare(`
      INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Insert a plain cookie
    stmt.run(
      ".example.com",
      "my_session",
      "session_content_123",
      Buffer.alloc(0),
      "/",
      webkitExpiry,
      1,
      1,
      1,
      "",
    );
    db.close();

    const mockSet = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockSession = {
      cookies: {
        set: mockSet,
        flushStore: mockFlush,
      },
    };

    const result = await importer.importSelectedCookies(
      {
        sourceId: "chrome",
        sourceProfileDirectory: "Default",
        targetProfileId: "work",
      },
      mockSession as any,
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockSet).toHaveBeenCalledWith({
      url: "https://example.com/",
      name: "my_session",
      value: "session_content_123",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expirationDate: 2208988800,
    });
    expect(mockFlush).toHaveBeenCalled();
  });

  it("reports Windows App-Bound cookies as partial while preserving readable cookies", async () => {
    const dbPath = Path.join(tempDir, "windows-cookies");
    const statePath = Path.join(tempDir, "Local State");
    await FS.writeFile(
      statePath,
      JSON.stringify({ os_crypt: { app_bound_encrypted_key: "synthetic" } }),
    );
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, top_frame_site_key TEXT)",
    );
    const insert = db.prepare(
      "INSERT INTO cookies VALUES ('example.com', ?, ?, ?, '/', 0, 1, 1, 1, '')",
    );
    insert.run("readable", "synthetic", Buffer.alloc(0));
    insert.run("bound", "", Buffer.concat([Buffer.from("v20"), Buffer.alloc(64)]));
    db.close();
    const result = await readChromiumCookies({
      cookieDatabasePath: dbPath,
      windowsLocalStatePath: statePath,
      platform: "win32",
    });
    expect(result.cookies.map((cookie) => cookie.name)).toEqual(["readable"]);
    expect(result.undecryptable).toBe(1);
    expect(result.warnings?.join(" ")).toContain("App-Bound");
  });

  it("stops importing after cancellation and flushes only completed writes", async () => {
    const userData = Path.join(tempDir, "CancelChrome");
    await FS.mkdir(Path.join(userData, "Default"), { recursive: true });
    const db = new DatabaseSync(Path.join(userData, "Default", "Cookies"));
    db.exec(
      "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, top_frame_site_key TEXT)",
    );
    const insert = db.prepare(
      "INSERT INTO cookies VALUES ('example.com', ?, 'synthetic', X'', '/', 0, 1, 1, 1, '')",
    );
    insert.run("first");
    insert.run("second");
    db.close();
    const controller = new AbortController();
    const set = vi.fn(async () => {
      controller.abort();
    });
    const flushStore = vi.fn(async () => undefined);
    const importer = new BrowserSessionImporter(
      "darwin",
      async () => false,
      { chrome: userData },
      { chrome: { cbcV10: Buffer.alloc(16) } },
    );
    const result = await importer.importSelectedCookies(
      { sourceId: "chrome", sourceProfileDirectory: "Default", targetProfileId: "test" },
      { cookies: { set, flushStore } },
      controller.signal,
    );
    expect(result).toMatchObject({ cancelled: true, imported: 1 });
    expect(set).toHaveBeenCalledTimes(1);
    expect(flushStore).toHaveBeenCalledOnce();
  });

  it("rejects a pre-cancelled import before reading the source", async () => {
    const running = vi.fn(async () => false);
    const importer = new BrowserSessionImporter("darwin", running);
    const signal = AbortSignal.abort();
    await expect(
      importer.importSelectedCookies(
        { sourceId: "chrome", sourceProfileDirectory: "Default", targetProfileId: "test" },
        undefined,
        signal,
      ),
    ).rejects.toThrow();
    expect(running).not.toHaveBeenCalled();
  });

  describe("CookieDatabase utilities", () => {
    it("preserves bareHost correctly", () => {
      expect(bareHost(".example.com")).toBe("example.com");
      expect(bareHost("example.com")).toBe("example.com");
    });

    it("scopes host-only vs domain cookies strictly according to RFC and Electron rules", () => {
      // Host-only cookie: domain MUST be undefined so Electron does not add leading dot or widen
      const hostOnly = cookieScope("app.example.com", "/dashboard", true);
      expect(hostOnly.url).toBe("https://app.example.com/dashboard");
      expect(hostOnly.domain).toBeUndefined();

      // Domain cookie: domain must have leading dot preserved
      const domainCookie = cookieScope(".example.com", "/", true);
      expect(domainCookie.url).toBe("https://example.com/");
      expect(domainCookie.domain).toBe(".example.com");

      // IPv6 host handling
      const ipv6 = cookieScope("2001:db8::1", "/api", false);
      expect(ipv6.url).toBe("http://[2001:db8::1]/api");
      expect(ipv6.domain).toBeUndefined();
    });

    it("creates isolated database snapshots", async () => {
      const dbPath = Path.join(tempDir, "test.sqlite");
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TABLE test (id INTEGER); INSERT INTO test VALUES (42);");
      db.close();

      const snapshot = await snapshotCookieDatabase(dbPath);
      expect(snapshot.path).not.toBe(dbPath);

      const snapDb = new DatabaseSync(snapshot.path, { readOnly: true });
      const row = snapDb.prepare("SELECT id FROM test").get() as { id: number };
      expect(row.id).toBe(42);
      snapDb.close();

      await snapshot.cleanup();
      await expect(FS.stat(snapshot.path)).rejects.toThrow();
    });
  });

  describe("Chromium cookie decryption & SQLite reader", () => {
    it("decrypts v10 AES-128-CBC records and handles plaintext legacy records", async () => {
      const key = deriveKey("test-pass", 1003);
      const iv = Buffer.alloc(16, 0x20);

      const cipher = NodeCrypto.createCipheriv("aes-128-cbc", key, iv);
      const encryptedValue = Buffer.concat([
        Buffer.from("v10"),
        cipher.update(Buffer.from("secret_cookie_payload")),
        cipher.final(),
      ]);

      const decrypted = decryptChromiumValue(
        encryptedValue,
        { cbcV10: key },
        ".example.com",
        23,
        "darwin",
      );
      expect(decrypted).toBe("secret_cookie_payload");

      // Test plaintext legacy record without prefix on macOS
      const plainTextValue = Buffer.from("legacy_plaintext_cookie");
      const plainDecrypted = decryptChromiumValue(
        plainTextValue,
        { cbcV10: key },
        ".example.com",
        23,
        "darwin",
      );
      expect(plainDecrypted).toBe("legacy_plaintext_cookie");
    });

    it("reads synthetic Chromium cookie database with schema version 23", async () => {
      const dbPath = Path.join(tempDir, "Cookies");
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta VALUES ('version', '23');
        CREATE TABLE cookies (
          host_key TEXT,
          name TEXT,
          value TEXT,
          encrypted_value BLOB,
          path TEXT,
          expires_utc INTEGER,
          is_secure INTEGER,
          is_httponly INTEGER,
          samesite INTEGER,
          top_frame_site_key TEXT
        );
      `);

      const key = deriveKey("mypassword", 1003);
      const cipher = NodeCrypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      const encrypted = Buffer.concat([
        Buffer.from("v10"),
        cipher.update(Buffer.from("session_xyz")),
        cipher.final(),
      ]);

      // WebKit timestamp for year 2026: (1767225600 + 11644473600) * 1000000
      const webkitExpiry = (1767225600 + 11644473600) * 1000000;

      const stmt = db.prepare(`
        INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        ".example.com",
        "sess",
        "",
        encrypted,
        "/",
        webkitExpiry,
        1,
        1,
        1, // Lax
        "",
      );
      // Insert host-only cookie
      stmt.run(
        "api.example.com",
        "api_key",
        "plain_api_key",
        Buffer.alloc(0),
        "/v1",
        webkitExpiry,
        1,
        0,
        2, // Strict
        "",
      );
      // Insert partitioned cookie (should be skipped)
      stmt.run(
        ".thirdparty.com",
        "part_id",
        "part_val",
        Buffer.alloc(0),
        "/",
        webkitExpiry,
        1,
        0,
        0,
        "https://example.com",
      );
      db.close();

      const result = await readChromiumCookies(
        {
          cookieDatabasePath: dbPath,
          platform: "darwin",
        },
        { cbcV10: key },
      );

      expect(result.cookies).toHaveLength(2);
      expect(result.undecryptable).toBe(1); // Partitioned cookie counted as skipped
      expect(result.undecryptableHosts).toContain("thirdparty.com");

      const domainCookie = result.cookies.find((c) => c.name === "sess")!;
      expect(domainCookie.value).toBe("session_xyz");
      expect(domainCookie.domain).toBe(".example.com");
      expect(domainCookie.sameSite).toBe("lax");
      expect(domainCookie.secure).toBe(true);
      expect(domainCookie.httpOnly).toBe(true);

      const hostOnlyCookie = result.cookies.find((c) => c.name === "api_key")!;
      expect(hostOnlyCookie.value).toBe("plain_api_key");
      expect(hostOnlyCookie.domain).toBeUndefined();
      expect(hostOnlyCookie.sameSite).toBe("strict");
      expect(hostOnlyCookie.url).toBe("https://api.example.com/v1");
    });
  });

  describe("Firefox unencrypted SQLite reader", () => {
    it("reads synthetic Firefox moz_cookies database with container isolation", async () => {
      const dbPath = Path.join(tempDir, "cookies.sqlite");
      const db = new DatabaseSync(dbPath);
      db.exec(`
        PRAGMA user_version = 16;
        CREATE TABLE moz_cookies (
          host TEXT,
          name TEXT,
          value TEXT,
          path TEXT,
          expiry INTEGER,
          isSecure INTEGER,
          isHttpOnly INTEGER,
          sameSite INTEGER,
          originAttributes TEXT
        );
      `);

      const stmt = db.prepare(`
        INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Expiry in schema 16 is in milliseconds
      stmt.run(".mozilla.org", "moz_sess", "secret123", "/", 1767225600000, 1, 1, 1, "");
      // Private window / container cookie with originAttributes (must be ignored)
      stmt.run(
        ".mozilla.org",
        "moz_container",
        "container123",
        "/",
        1767225600000,
        1,
        1,
        1,
        "^userContextId=2",
      );
      db.close();

      const cookies = await readFirefoxCookies(dbPath);
      expect(cookies).toHaveLength(1);
      expect(cookies[0]!.name).toBe("moz_sess");
      expect(cookies[0]!.value).toBe("secret123");
      expect(cookies[0]!.domain).toBe(".mozilla.org");
      expect(cookies[0]!.expirationDate).toBe(1767225600);
      expect(cookies[0]!.sameSite).toBe("lax");
    });
  });

  describe("Safari binarycookies parser", () => {
    function encodeCookie(cookie: {
      domain: string;
      name: string;
      path: string;
      value: string;
      flags: number;
      expiry: number;
    }): Buffer {
      const strings = [cookie.domain, cookie.name, cookie.path, cookie.value];
      const headerSize = 56;
      const offsets: number[] = [];
      let cursor = headerSize;
      for (const val of strings) {
        offsets.push(cursor);
        cursor += Buffer.byteLength(val) + 1;
      }
      const size = cursor;
      const buffer = Buffer.alloc(size);
      buffer.writeUInt32LE(size, 0);
      buffer.writeUInt32LE(0, 4);
      buffer.writeUInt32LE(cookie.flags, 8);
      buffer.writeUInt32LE(0, 12);
      buffer.writeUInt32LE(offsets[0]!, 16);
      buffer.writeUInt32LE(offsets[1]!, 20);
      buffer.writeUInt32LE(offsets[2]!, 24);
      buffer.writeUInt32LE(offsets[3]!, 28);
      buffer.writeUInt32LE(0, 32);
      buffer.writeUInt32LE(0, 36);
      buffer.writeDoubleLE(cookie.expiry, 40);
      buffer.writeDoubleLE(0, 48);
      strings.forEach((val, idx) => {
        buffer.write(val, offsets[idx]!, "utf8");
      });
      return buffer;
    }

    it("parses valid binarycookies buffer and rejects malformed buffer", () => {
      // Malformed header
      expect(() => parseBinaryCookies(Buffer.from("invalid_header"))).toThrow();

      const encoded = [
        encodeCookie({
          domain: ".apple.com",
          name: "safari_id",
          path: "/",
          value: "safari_val_123",
          flags: 0x1 | 0x4, // secure | httpOnly
          expiry: 750000000,
        }),
      ];

      const headerSize = 12 + encoded.length * 4;
      const offsets: number[] = [];
      let cursor = headerSize;
      for (const cookie of encoded) {
        offsets.push(cursor);
        cursor += cookie.length;
      }

      const page = Buffer.alloc(cursor);
      page.writeUInt32BE(0x00000100, 0);
      page.writeUInt32LE(encoded.length, 4);
      offsets.forEach((offset, idx) => page.writeUInt32LE(offset, 8 + idx * 4));
      encoded.forEach((cookie, idx) => cookie.copy(page, offsets[idx]!));

      const fileHeader = Buffer.alloc(12);
      fileHeader.write("cook", 0, "latin1");
      fileHeader.writeUInt32BE(1, 4);
      fileHeader.writeUInt32BE(page.length, 8);

      const fileBuf = Buffer.concat([fileHeader, page]);

      const parsed = parseBinaryCookies(fileBuf);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe("safari_id");
      expect(parsed[0]!.value).toBe("safari_val_123");
      expect(parsed[0]!.domain).toBe(".apple.com");
      expect(parsed[0]!.secure).toBe(true);
      expect(parsed[0]!.httpOnly).toBe(true);
      expect(parsed[0]!.url).toBe("https://apple.com/");
    });
  });

  describe("importSyntheticCookiesToSession", () => {
    it("preserves Secure, HttpOnly, SameSite, domain, path, and expiration semantics", async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockSession = { cookies: { set: mockSet } };

      const syntheticCookies = [
        {
          name: "session_token",
          value: "secret_value_123",
          domain: "example.com",
          path: "/auth",
          secure: true,
          httpOnly: true,
          sameSite: "strict" as const,
          expirationDate: 1893456000,
        },
      ];

      const result = await importSyntheticCookiesToSession(mockSession, "work", syntheticCookies);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(mockSet).toHaveBeenCalledWith({
        url: "https://example.com/auth",
        name: "session_token",
        value: "secret_value_123",
        domain: "example.com",
        path: "/auth",
        secure: true,
        httpOnly: true,
        sameSite: "strict",
        expirationDate: 1893456000,
      });
    });

    it("filters to allowed requested domains and deterministic partial failure reporting", async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockSession = { cookies: { set: mockSet } };

      const cookies = [
        {
          name: "token_app",
          value: "val1",
          domain: "app.example.com",
          secure: true,
        },
        {
          name: "tracker",
          value: "val2",
          domain: "thirdparty-tracker.net",
          secure: true,
        },
      ];

      const result = await importSyntheticCookiesToSession(mockSession, "work", cookies, {
        allowedDomains: ["app.example.com"],
      });

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.skippedDomains).toContain("thirdparty-tracker.net");
    });

    it("handles cookie injection errors gracefully without leaking cookie values", async () => {
      const mockSet = vi.fn().mockRejectedValue(new Error("Invalid cookie"));
      const mockSession = { cookies: { set: mockSet } };

      const cookies = [
        {
          name: "bad_cookie",
          value: "super_secret_value",
          domain: "faulty.com",
        },
      ];

      const result = await importSyntheticCookiesToSession(mockSession, "work", cookies);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedDomains).toEqual(["faulty.com"]);
    });

    it("rejects invalid profile identifiers", async () => {
      const mockSession = { cookies: { set: vi.fn() } };

      await expect(
        importSyntheticCookiesToSession(mockSession, "../../../etc", []),
      ).rejects.toThrow("Invalid browser profile identifier");
    });
  });
});
