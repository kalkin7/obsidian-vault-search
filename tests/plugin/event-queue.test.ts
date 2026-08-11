import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultEventQueue } from "../../src/vault-event-queue";

afterEach(() => vi.useRealTimers());

describe("VaultEventQueue", () => {
  it("coalesces changes and preserves a rejected batch", async () => {
    vi.useFakeTimers();
    let accept = false;
    const calls: string[][] = [];
    const queue = new VaultEventQueue(() => 100, async changed => {
      calls.push(changed); return accept;
    });
    queue.markChanged("a.md");
    queue.markChanged("a.md");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([["a.md"]]);
    accept = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual([["a.md"], ["a.md"]]);
    queue.clear();
  });

  it("limits batches", async () => {
    const batches: string[][] = [];
    const queue = new VaultEventQueue(() => 100, async changed => {
      batches.push(changed); return true;
    }, 2);
    queue.markChanged("a.md"); queue.markChanged("b.md"); queue.markChanged("c.md");
    await queue.flush(); await queue.flush();
    expect(batches.flat().sort()).toEqual(["a.md", "b.md", "c.md"]);
    queue.clear();
  });
});
