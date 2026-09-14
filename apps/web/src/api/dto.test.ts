import { describe, expect, it } from "vitest";

import { liveRegistryResponseSchema } from "./dto";

const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const reputationRegistry =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const wallet = "0x377711a26B52F4AD8C548AAEF8297E0563b87Db4";
const hash = `0x${"11".repeat(32)}`;
const endpoint = "https://selantar.vercel.app/api/mediate";

describe("live Registry response", () => {
  it("parses verified contract, locator, receipt, and tag diagnostics", () => {
    const result = liveRegistryResponseSchema.parse({
      enabled: true,
      source: "live-rpc",
      fixtureMode: "available",
      model: "B1_RAW",
      chainId: 84_532,
      identityRegistry: registry,
      reputationRegistry,
      identity: {
        agent: { chainId: 84_532, registry, agentId: "2122" },
        owner: wallet,
        agentWallet: wallet,
        registeredEndpoint: endpoint,
        endpointHash: hash,
        agentUriHash: hash,
        identityEpoch: hash,
        observedAtBlock: "46795693",
      },
      feedbackSource: "contract-state",
      locatorSource: "api.8004scan.io",
      verificationStatus: "VERIFIED",
      onchainFeedbackCount: 14,
      locatorFeedbackCount: 14,
      verifiedReceiptCount: 14,
      verificationIssueCounts: [],
      feedbackCount: 14,
      inspectionScope: { tag1: "quality", tag2: null, endpoint },
      tag1Distribution: [{ value: "mediationSuccess", count: 14 }],
      tag2Distribution: [{ value: "softwareDispute", count: 3 }],
      rawScoreBps: null,
      confidenceBps: 0,
      distinctReviewerCount: 0,
      eligibleFeedbackCount: 0,
      rejectedFeedbackCount: 14,
      rejectionReasonCounts: [{ reason: "TAG_MISMATCH", count: 14 }],
      riskFlags: ["NO_ELIGIBLE_FEEDBACK", "LOW_DISTINCT_REVIEWER_COUNT"],
    });

    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.verificationStatus).toBe("VERIFIED");
      expect(result.verifiedReceiptCount).toBe(14);
    }
  });
});
