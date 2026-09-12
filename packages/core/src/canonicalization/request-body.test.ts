import { describe, expect, it } from "vitest";

import { hashRequestBody } from "./request-body";

describe("hashRequestBody", () => {
  it("uses the Ethereum keccak256 empty-value vector when no body exists", () => {
    expect(hashRequestBody()).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("hashes a string as UTF-8 bytes", () => {
    expect(hashRequestBody("RepuGate 锁")).toBe(
      hashRequestBody(new TextEncoder().encode("RepuGate 锁")),
    );
  });

  it("changes when the exact request bytes change", () => {
    expect(hashRequestBody('{"prompt":"safe"}')).not.toBe(
      hashRequestBody('{"prompt":"unsafe"}'),
    );
  });
});
