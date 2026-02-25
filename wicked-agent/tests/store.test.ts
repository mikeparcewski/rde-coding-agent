/**
 * Tests for JsonlStore and JsonStore.
 *
 * Uses vi.mock('node:fs/promises') to avoid touching the real filesystem.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock node:fs/promises before importing store modules ───────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  appendFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock node:crypto for deterministic UUIDs in JsonStore tmp path
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001"),
}));

import * as fs from "node:fs/promises";
import { JsonlStore } from "../src/store/jsonl-store.js";
import { JsonStore } from "../src/store/json-store.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

interface TestEntry {
  schemaVersion: 1;
  id: string;
  value: string;
}

const CURRENT_VERSION = 1;

function identityMigrate(raw: Record<string, unknown>): TestEntry {
  return {
    schemaVersion: 1,
    id: (raw["id"] as string) ?? "migrated",
    value: (raw["value"] as string) ?? "",
  };
}

function makeEntry(id: string, value: string): TestEntry {
  return { schemaVersion: 1, id, value };
}

// ── JsonlStore ─────────────────────────────────────────────────────────────────

describe("JsonlStore", () => {
  let store: JsonlStore<TestEntry>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new JsonlStore<TestEntry>(
      "/tmp/test.jsonl",
      CURRENT_VERSION,
      identityMigrate,
    );
  });

  describe("append", () => {
    it("calls appendFile with JSON.stringify(entry) + newline", async () => {
      const mockAppend = vi.mocked(fs.appendFile).mockResolvedValue(undefined);
      const mockMkdir = vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const entry = makeEntry("abc123", "hello world");
      await store.append(entry);

      expect(mockMkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
      expect(mockAppend).toHaveBeenCalledWith(
        "/tmp/test.jsonl",
        JSON.stringify(entry) + "\n",
        "utf-8",
      );
    });
  });

  describe("readAll", () => {
    it("returns empty array when file does not exist (ENOENT)", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await store.readAll();
      expect(result).toEqual([]);
    });

    it("parses multiple valid JSONL lines", async () => {
      const e1 = makeEntry("id-1", "alpha");
      const e2 = makeEntry("id-2", "beta");
      const content = [JSON.stringify(e1), JSON.stringify(e2)].join("\n") + "\n";

      vi.mocked(fs.readFile).mockResolvedValue(content as never);

      const result = await store.readAll();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(e1);
      expect(result[1]).toEqual(e2);
    });

    it("skips blank and whitespace-only lines", async () => {
      const entry = makeEntry("id-1", "alpha");
      const content = "\n  \n" + JSON.stringify(entry) + "\n\n";

      vi.mocked(fs.readFile).mockResolvedValue(content as never);

      const result = await store.readAll();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(entry);
    });

    it("skips malformed (non-JSON) lines without throwing", async () => {
      const entry = makeEntry("id-1", "good");
      const content =
        "NOT_JSON\n" + JSON.stringify(entry) + "\n{broken json\n";

      vi.mocked(fs.readFile).mockResolvedValue(content as never);

      const result = await store.readAll();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(entry);
    });

    it("calls migrate() for entries with old schemaVersion", async () => {
      const migrateSpy = vi.fn((raw: Record<string, unknown>): TestEntry => ({
        schemaVersion: 1,
        id: raw["id"] as string,
        value: "migrated",
      }));
      const storeWithSpy = new JsonlStore<TestEntry>(
        "/tmp/test.jsonl",
        CURRENT_VERSION,
        migrateSpy,
      );

      const oldEntry = { schemaVersion: 0, id: "old-id", value: "old" };
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(oldEntry) + "\n") as never,
      );

      const result = await storeWithSpy.readAll();
      expect(migrateSpy).toHaveBeenCalledOnce();
      expect(result[0]!.value).toBe("migrated");
    });

    it("does NOT call migrate() for entries at current schemaVersion", async () => {
      const migrateSpy = vi.fn(identityMigrate);
      const storeWithSpy = new JsonlStore<TestEntry>(
        "/tmp/test.jsonl",
        CURRENT_VERSION,
        migrateSpy,
      );

      const currentEntry = makeEntry("curr-id", "current");
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(currentEntry) + "\n") as never,
      );

      await storeWithSpy.readAll();
      expect(migrateSpy).not.toHaveBeenCalled();
    });
  });

  describe("deleteById", () => {
    it("returns false when id is not found (empty file)", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await store.deleteById("nonexistent");
      expect(result).toBe(false);
    });

    it("returns false when id is not in file", async () => {
      const entry = makeEntry("id-1", "value");
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(entry) + "\n") as never,
      );

      const result = await store.deleteById("unknown-id");
      expect(result).toBe(false);
    });

    it("removes the correct entry and rewrites file", async () => {
      const e1 = makeEntry("keep", "keep-value");
      const e2 = makeEntry("delete-me", "bye");
      const e3 = makeEntry("also-keep", "also-keep-value");
      const content = [e1, e2, e3].map((e) => JSON.stringify(e)).join("\n") + "\n";

      vi.mocked(fs.readFile).mockResolvedValue(content as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await store.deleteById("delete-me");
      expect(result).toBe(true);

      const written = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      expect(written).toContain("keep");
      expect(written).toContain("also-keep");
      expect(written).not.toContain("delete-me");
    });

    it("writes empty content (no trailing entries) when last entry is deleted", async () => {
      const entry = makeEntry("only-one", "value");
      vi.mocked(fs.readFile).mockResolvedValue(
        (JSON.stringify(entry) + "\n") as never,
      );
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await store.deleteById("only-one");
      expect(result).toBe(true);

      const written = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      // After deleting last entry, file content should be empty (no trailing newline)
      expect(written).toBe("");
    });
  });
});

// ── JsonStore ──────────────────────────────────────────────────────────────────

interface TestDoc {
  schemaVersion: 1;
  name: string;
}

describe("JsonStore", () => {
  let store: JsonStore<TestDoc>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new JsonStore<TestDoc>(
      "/tmp/docs/state.json",
      1,
      (raw) => ({ schemaVersion: 1, name: (raw["name"] as string) ?? "migrated" }),
      () => ({ schemaVersion: 1, name: "default" }),
    );
  });

  describe("write", () => {
    it("creates parent directory with recursive: true", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await store.write({ schemaVersion: 1, name: "hello" });

      expect(fs.mkdir).toHaveBeenCalledWith("/tmp/docs", { recursive: true });
    });

    it("writes to a .tmp file then renames to final path (atomic write)", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await store.write({ schemaVersion: 1, name: "hello" });

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]!;
      const tmpPath = writeCall[0] as string;
      expect(tmpPath).toContain(".tmp-");
      expect(tmpPath).toContain(".json");
      expect(tmpPath).not.toBe("/tmp/docs/state.json");

      expect(fs.rename).toHaveBeenCalledWith(tmpPath, "/tmp/docs/state.json");
    });
  });

  describe("read", () => {
    it("returns defaultValue when file does not exist (ENOENT)", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const result = await store.read();
      expect(result).toEqual({ schemaVersion: 1, name: "default" });
    });

    it("returns document unchanged when schemaVersion matches", async () => {
      const doc: TestDoc = { schemaVersion: 1, name: "current" };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(doc) as never);

      const result = await store.read();
      expect(result).toEqual(doc);
    });

    it("calls migrate() when schemaVersion is stale", async () => {
      const oldDoc = { schemaVersion: 0, name: "old-name" };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(oldDoc) as never);

      const result = await store.read();
      // Our migrate function sets name to the raw value
      expect(result.schemaVersion).toBe(1);
      expect(result.name).toBe("old-name");
    });
  });

  describe("update", () => {
    it("reads current value, applies transform, writes result", async () => {
      const initial: TestDoc = { schemaVersion: 1, name: "before" };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(initial) as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const result = await store.update((doc) => ({
        ...doc,
        name: "after",
      }));

      expect(result.name).toBe("after");
      const written = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      expect(JSON.parse(written).name).toBe("after");
    });
  });
});
