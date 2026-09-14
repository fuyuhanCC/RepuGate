import { describe, expect, it, vi } from "vitest";

import type { Address, AgentReference } from "@repugate/core";
import { getAddress } from "viem";

import {
  FeedbackLocatorError,
  locateIndexedFeedback,
} from "./8004scan-locator";

const reference: AgentReference = {
  chainId: 84_532,
  registry:
    "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  agentId: 2_122n,
};

const reviewer =
  "0x7c41d01c95f55c5590e65c8f91b4f854316d1da4" as Address;
const transactionHash = `0x${"11".repeat(32)}` as const;

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        chain_id: reference.chainId,
        transaction_hash: transactionHash,
        block_number: 39_580_098,
        user_address: reviewer,
        feedback_index: 14,
        agent: {
          token_id: reference.agentId.toString(),
          chain_id: reference.chainId,
          registry_address: reference.registry,
        },
        ...overrides,
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
  };
}

describe("8004scan feedback locator", () => {
  it("returns only minimal transaction locators for the configured Agent", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      new Response(JSON.stringify(page()), {
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await locateIndexedFeedback(
      "https://api.8004scan.io/api/v1",
      reference,
      fetch,
    );

    expect(result).toEqual([
      {
        clientAddress: getAddress(reviewer),
        feedbackIndex: 14n,
        transactionHash,
        blockNumber: 39_580_098n,
      },
    ]);
    const requestedUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/api/v1/feedbacks");
    expect(requestedUrl.searchParams.get("agent_token_id")).toBe("2122");
    expect(requestedUrl.searchParams.get("include_revoked")).toBe("true");
  });

  it("rejects index results outside the requested Agent scope", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      new Response(JSON.stringify(page({ chain_id: 1 })), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      locateIndexedFeedback(
        "https://api.8004scan.io/api/v1",
        reference,
        fetch,
      ),
    ).rejects.toBeInstanceOf(FeedbackLocatorError);
  });

  it("rejects private indexer URLs before making a request", async () => {
    const fetch = vi.fn();

    await expect(
      locateIndexedFeedback("http://127.0.0.1:8000", reference, fetch),
    ).rejects.toBeInstanceOf(FeedbackLocatorError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
