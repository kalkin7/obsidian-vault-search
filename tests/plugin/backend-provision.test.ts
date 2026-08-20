import { describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as zlib from "zlib";
import AdmZip from "adm-zip";

const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: requestUrlMock }));

import { BackendManager } from "../../src/backend-manager";
import type { VaultSearchSettings } from "../../src/types";

const VERSION = "0.1.2";

function makeZip(entries: Array<[string, string]>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

/** Build a stored (uncompressed) zip with raw entry names. AdmZip.addFile
 *  normalizes paths, so a traversal entry (backend/../../x) cannot be produced
 *  through it; a real malicious archive can carry such a name. */
function buildRawZip(entries: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = zlib.crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDir, eocd]);
}

async function makeManager(tmp: string): Promise<BackendManager> {
  const pluginDir = path.join(tmp, "plugin");
  await fs.mkdir(path.join(pluginDir, "backend"), { recursive: true });
  return new BackendManager(
    path.join(tmp, "vault"),
    pluginDir,
    () => ({ pythonExecutable: "python" }) as unknown as VaultSearchSettings,
    () => undefined,
    VERSION
  );
}

function pluginBackendRoot(tmp: string): string {
  return path.join(tmp, "plugin", "backend");
}

describe("backend provisioning", () => {
  it("downloads and extracts the backend when missing", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      requestUrlMock.mockResolvedValue({
        status: 200,
        arrayBuffer: makeZip([
          ["backend/vault_search/__init__.py", `__version__ = "${VERSION}"`],
          ["backend/vault_search/__main__.py", "if __name__ == '__main__': pass"],
          ["backend/setup-runtime.ps1", "# setup"],
        ]),
      });
      const manager = await makeManager(tmp);

      const ok = await manager.ensureBackendProvisioned();

      expect(ok).toBe(true);
      expect(requestUrlMock).toHaveBeenCalledTimes(1);
      const url = requestUrlMock.mock.calls[0][0].url as string;
      expect(url).toContain(`/releases/download/v${VERSION}/obsidian-vault-search-v${VERSION}.zip`);
      expect(await fs.readFile(path.join(pluginBackendRoot(tmp), "vault_search", "__init__.py"), "utf8"))
        .toContain(VERSION);
      expect(await fs.readFile(path.join(pluginBackendRoot(tmp), "setup-runtime.ps1"), "utf8"))
        .toContain("# setup");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips the download when the backend version already matches", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      const root = pluginBackendRoot(tmp);
      await fs.mkdir(path.join(root, "vault_search"), { recursive: true });
      await fs.writeFile(path.join(root, "vault_search", "__init__.py"), `__version__ = "${VERSION}"`);
      requestUrlMock.mockClear();
      const manager = await makeManager(tmp);

      const ok = await manager.ensureBackendProvisioned();

      expect(ok).toBe(true);
      expect(requestUrlMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("force re-downloads even when the version matches", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      const root = pluginBackendRoot(tmp);
      await fs.mkdir(path.join(root, "vault_search"), { recursive: true });
      await fs.writeFile(path.join(root, "vault_search", "__init__.py"), `__version__ = "${VERSION}"`);
      requestUrlMock.mockResolvedValue({
        status: 200,
        arrayBuffer: makeZip([["backend/vault_search/__init__.py", `__version__ = "${VERSION}"`]]),
      });
      const manager = await makeManager(tmp);

      await manager.ensureBackendProvisioned({ force: true });

      expect(requestUrlMock).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects zip-slip entries outside backend/", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      requestUrlMock.mockResolvedValue({
        status: 200,
        arrayBuffer: buildRawZip([
          ["backend/vault_search/__init__.py", `__version__ = "${VERSION}"`],
          ["backend/ok.txt", "fine"],
          ["backend/../../escaped.txt", "evil"],
        ]),
      });
      const manager = await makeManager(tmp);

      await expect(manager.ensureBackendProvisioned()).rejects.toThrow(/안전하지 않은 zip/);

      const escaped = path.join(tmp, "escaped.txt");
      expect(await fs.stat(escaped).catch(() => null)).toBeNull();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("fails when the zip has no backend/ folder", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      requestUrlMock.mockResolvedValue({
        status: 200,
        arrayBuffer: makeZip([["main.js", "// js only"]]),
      });
      const manager = await makeManager(tmp);

      await expect(manager.ensureBackendProvisioned()).rejects.toThrow(/backend\/ 폴더가 없습니다/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces a failed download with a clear error", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      requestUrlMock.mockResolvedValue({ status: 404, arrayBuffer: new ArrayBuffer(0) });
      const manager = await makeManager(tmp);

      await expect(manager.ensureBackendProvisioned()).rejects.toThrow(/HTTP 404/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("handles Windows backslash separators in zip entries gracefully", async () => {
    const tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".provision-test-"));
    try {
      requestUrlMock.mockResolvedValue({
        status: 200,
        arrayBuffer: buildRawZip([
          ["backend\\vault_search\\__init__.py", `__version__ = "${VERSION}"`],
          ["backend\\vault_search\\cli.py", "# cli"],
          ["backend\\setup-runtime.ps1", "# setup"],
        ]),
      });
      const manager = await makeManager(tmp);

      const ok = await manager.ensureBackendProvisioned();

      expect(ok).toBe(true);
      expect(await fs.readFile(path.join(pluginBackendRoot(tmp), "vault_search", "__init__.py"), "utf8"))
        .toContain(VERSION);
      expect(await fs.readFile(path.join(pluginBackendRoot(tmp), "vault_search", "cli.py"), "utf8"))
        .toContain("# cli");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
