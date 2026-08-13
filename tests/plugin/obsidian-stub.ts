/** Minimal runtime stand-in for the `obsidian` module in vitest.
 *
 * The published `obsidian` package is types-only (no JS entry), so vite cannot
 * resolve it as a runtime module. Tests that exercise src modules importing
 * obsidian symbols alias it to this stub; `vi.mock("obsidian")` then overrides
 * the specific functions under test.
 */
export function requestUrl(): never {
  throw new Error("obsidian.requestUrl was not mocked");
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}
