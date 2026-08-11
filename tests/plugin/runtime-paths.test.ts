import { describe, expect, it } from "vitest";
import { canonicalVaultPath, vaultId } from "../../src/runtime-paths";

describe("runtime paths", () => {
  it("creates stable portable vault ids", () => {
    expect(vaultId(".")).toBe(vaultId(canonicalVaultPath(".")));
    expect(vaultId(".")).toMatch(/^[a-f0-9]{20}$/);
  });
});
