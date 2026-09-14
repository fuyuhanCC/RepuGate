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

  it("uses the public 8004scan endpoint only as a feedback locator by default", () => {
    const runtime = loadLiveErc8004Runtime({
      REPUGATE_LIVE_ERC8004: "true",
      ERC8004_CHAIN_ID: "84532",
      ERC8004_RPC_URL: "https://sepolia.base.org",
      ERC8004_IDENTITY_REGISTRY:
        "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      ERC8004_REPUTATION_REGISTRY:
        "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      ERC8004_AGENT_ID: "2122",
      ERC8004_SERVICE_ENDPOINT:
        "https://selantar.vercel.app/api/mediate",
    });

    expect(runtime?.config.feedbackIndexerUrl).toBe(
      "https://api.8004scan.io/api/v1",
    );
  });
});
