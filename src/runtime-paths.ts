import { createHash } from "crypto";
import * as path from "path";

export function canonicalVaultPath(vaultPath: string): string {
  const normalized = path.resolve(vaultPath).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function vaultId(vaultPath: string): string {
  return createHash("sha256").update(canonicalVaultPath(vaultPath), "utf8").digest("hex").slice(0, 20);
}

export function localDataRoot(): string {
  const root = process.env.LOCALAPPDATA || path.join(process.env.HOME || process.cwd(), ".local", "share");
  return path.join(root, "ObsidianVaultSearch");
}

export function vaultDataDir(vaultPath: string): string {
  return path.join(localDataRoot(), "vaults", vaultId(vaultPath));
}
