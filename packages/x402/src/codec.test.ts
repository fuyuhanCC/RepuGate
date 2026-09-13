import { describe, expect, it } from "vitest";
import { z } from "zod";

import { decodeX402Header, encodeX402Header, X402HeaderError } from "./codec";

describe("x402 header codec", () => {
  it("round-trips UTF-8 JSON through base64", () => {
    const schema = z.object({ message: z.string() });
    const encoded = encodeX402Header({ message: "付款已提交" });

    expect(decodeX402Header(encoded, schema)).toEqual({
      message: "付款已提交",
    });
  });

  it("rejects malformed or schema-invalid headers", () => {
    expect(() => decodeX402Header("not base64!", z.unknown())).toThrow(
      X402HeaderError,
    );
    expect(() =>
      decodeX402Header(encodeX402Header({ value: 1 }), z.string()),
    ).toThrow(X402HeaderError);
  });
});
