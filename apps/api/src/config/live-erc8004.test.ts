import { describe, expect, it } from "vitest";

import { loadLiveErc8004Runtime } from "./live-erc8004";

describe("live ERC-8004 configuration", () => {
  it("ignores every live setting when the feature is disabled", () => {
    expect(
      loadLiveErc8004Runtime({
        REPUGATE_LIVE_ERC8004: "false",
        ERC8004_CHAIN_ID: "not-a-chain",
        ERC8004_RPC_URL: "not-a-url",
      }),
    ).toBeUndefined();
  });

  it("requires explicit registry settings when live mode is enabled", () => {
    expect(() =>
      loadLiveErc8004Runtime({ REPUGATE_LIVE_ERC8004: "true" }),
    ).toThrow(
      "ERC8004_CHAIN_ID is required when REPUGATE_LIVE_ERC8004=true",
    );
  });
});
