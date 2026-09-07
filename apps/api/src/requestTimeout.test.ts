import { describe, expect, it } from "vitest";
import { withRequestTimeout } from "./requestTimeout.js";

describe("withRequestTimeout", () => {
  it("rejects when an operation runs past the configured timeout", async () => {
    await expect(
      withRequestTimeout(
        () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 200)),
        50,
        "slow refresh"
      )
    ).rejects.toThrow("slow refresh timed out after 50ms");
  });

  it("resolves when the operation finishes within the timeout", async () => {
    await expect(
      withRequestTimeout(() => Promise.resolve("done"), 100, "fast refresh")
    ).resolves.toBe("done");
  });
});
