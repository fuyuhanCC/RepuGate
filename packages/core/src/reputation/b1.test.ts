import { describe, expect, it } from "vitest";

import { IDENTITY, makeFeedback, REVIEWERS } from "../testing/fixtures";
import { assessB1RawReputation } from "./b1";

const scope = {
  agent: IDENTITY.agent,
  endpoint: IDENTITY.registeredEndpoint,
  tag1: "quality",
  tag2: "inference",
};

describe("B1 raw ERC-8004 reputation", () => {
  it("accepts ungrounded high ratings and demonstrates the baseline weakness", () => {
    const feedback = REVIEWERS.map((clientAddress, index) =>
      makeFeedback({
        clientAddress,
        feedbackIndex: BigInt(index + 1),
        value: 100n,
      }),
    );

    const result = assessB1RawReputation({ feedback, scope });

    expect(result.scoreBps).toBe(10_000);
    expect(result.confidenceBps).toBe(7_142);
    expect(result.acceptedFeedback).toHaveLength(5);
  });

  it("filters revoked, wrong-tag, wrong-endpoint, and out-of-range records", () => {
    const feedback = [
      makeFeedback({ feedbackIndex: 1n, isRevoked: true }),
      makeFeedback({ feedbackIndex: 2n, tag1: "latency" }),
      makeFeedback({
        feedbackIndex: 3n,
        endpoint: "https://attacker.example/service",
      }),
      makeFeedback({ feedbackIndex: 4n, value: 101n }),
      makeFeedback({ feedbackIndex: 5n, value: 75n }),
    ];

    const result = assessB1RawReputation({ feedback, scope });

    expect(result.scoreBps).toBe(7_500);
    expect(result.rejectedFeedback.map((item) => item.reason)).toEqual([
      "REVOKED",
      "TAG_MISMATCH",
      "ENDPOINT_MISMATCH",
      "VALUE_OUT_OF_RANGE",
    ]);
  });
});
