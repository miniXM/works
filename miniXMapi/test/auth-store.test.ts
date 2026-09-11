import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth-store.js";

describe("gateway customer keys", () => {
  it("returns a key once and persists only its digest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gateway-auth-"));
    const store = new AuthStore(join(dir, "auth.json"));
    await store.init();
    const account = await store.createAccount("test");
    const created = await store.createKey(account.id);
    expect(store.authenticate(created.key)?.id).toBe(account.id);
    expect(await readFile(join(dir, "auth.json"), "utf8")).not.toContain(created.key);
  });
});
