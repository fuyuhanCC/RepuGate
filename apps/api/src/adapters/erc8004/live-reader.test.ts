import { describe, expect, it, vi } from "vitest";

import type { Address, AgentReference } from "@repugate/core";
import { assessB1RawReputation } from "@repugate/core";
import type { PublicClient } from "viem";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";

import { newFeedbackEvent } from "./abi";
import {
  LiveErc8004Error,
  LiveErc8004Reader,
  type LiveErc8004ReaderConfig,
} from "./live-reader";

const IDENTITY_REGISTRY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const REPUTATION_REGISTRY =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const AGENT_WALLET =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const REVIEWER_A =
  "0x1111111111111111111111111111111111111111" as Address;
const REVIEWER_B =
  "0x2222222222222222222222222222222222222222" as Address;
const ENDPOINT = "https://agent.example/services/inference";
const ZERO_HASH = `0x${"00".repeat(32)}` as const;
const TX_A = `0x${"aa".repeat(32)}` as const;
const TX_B = `0x${"bb".repeat(32)}` as const;

const reference: AgentReference = {
  chainId: 84_532,
  registry: IDENTITY_REGISTRY,
  agentId: 12n,
};

const config: LiveErc8004ReaderConfig = {
  chainId: reference.chainId,
  identityRegistry: IDENTITY_REGISTRY,
  reputationRegistry: REPUTATION_REGISTRY,
  serviceEndpoint: ENDPOINT,
  feedbackIndexerUrl: "https://api.8004scan.io/api/v1",
};

function registration(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Live Agent",
    services: [{ name: "A2A", endpoint: ENDPOINT, version: "1" }],
    registrations: [
      {
        agentRegistry: `eip155:${reference.chainId}:${IDENTITY_REGISTRY}`,
        agentId: reference.agentId.toString(),
      },
    ],
    ...overrides,
  });
}

function encodedFeedbackLog(
  clientAddress: Address,
  feedbackIndex: bigint,
  value: bigint,
) {
  return {
    address: REPUTATION_REGISTRY,
    topics: encodeEventTopics({
      abi: [newFeedbackEvent],
      eventName: "NewFeedback",
      args: {
        agentId: reference.agentId,
        clientAddress,
        indexedTag1: "quality",
      },
    }),
    data: encodeAbiParameters(
      parseAbiParameters(
        "uint64, int128, uint8, string, string, string, string, bytes32",
      ),
      [
        feedbackIndex,
        value,
        0,
        "quality",
        "inference",
        ENDPOINT,
        "",
        ZERO_HASH,
      ],
    ),
  };
}

function fakeClient(options: { boundRegistry?: Address } = {}) {
  const getBlockNumber = vi.fn(async () => 500n);
  const readContract = vi.fn(async (request: { functionName: string }) => {
    switch (request.functionName) {
      case "ownerOf":
        return OWNER;
      case "getAgentWallet":
        return AGENT_WALLET;
      case "tokenURI":
        return "https://metadata.example/agent.json";
      case "getIdentityRegistry":
        return options.boundRegistry ?? IDENTITY_REGISTRY;
      case "readAllFeedback":
        return [
          [REVIEWER_A, REVIEWER_B],
          [1n, 1n],
          [90n, 100n],
          [0, 0],
          ["quality", "quality"],
          ["inference", "inference"],
          [false, true],
        ] as const;
      default:
        throw new Error(`Unexpected contract call: ${request.functionName}`);
    }
  });
  const getTransactionReceipt = vi.fn(
    async (request: { hash: typeof TX_A | typeof TX_B }) => {
      const isFirst = request.hash === TX_A;
      const blockNumber = isFirst ? 400n : 420n;
      return {
        status: "success" as const,
        blockNumber,
        logs: [
          encodedFeedbackLog(
            isFirst ? REVIEWER_A : REVIEWER_B,
            1n,
            isFirst ? 90n : 100n,
          ),
        ],
      };
    },
  );
  const client = {
    getChainId: vi.fn(async () => reference.chainId),
    getBlockNumber,
    readContract,
    getTransactionReceipt,
  } as unknown as PublicClient;

  return { client, getBlockNumber, getTransactionReceipt };
}

function indexerPage(): Record<string, unknown> {
  return {
    items: [
      {
        chain_id: reference.chainId,
        transaction_hash: TX_A,
        block_number: 400,
        user_address: REVIEWER_A,
        feedback_index: 1,
        agent: {
          token_id: reference.agentId.toString(),
          chain_id: reference.chainId,
          registry_address: IDENTITY_REGISTRY,
        },
      },
      {
        chain_id: reference.chainId,
        transaction_hash: TX_B,
        block_number: 420,
        user_address: REVIEWER_B,
        feedback_index: 1,
        agent: {
          token_id: reference.agentId.toString(),
          chain_id: reference.chainId,
          registry_address: IDENTITY_REGISTRY,
        },
      },
    ],
    total: 2,
    limit: 100,
    offset: 0,
  };
}

function liveFetch(options: { indexerStatus?: number } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.hostname === "api.8004scan.io") {
      return new Response(JSON.stringify(indexerPage()), {
        status: options.indexerStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(registration(), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("LiveErc8004Reader", () => {
  it("loads identity and feedback from one deterministic RPC snapshot", async () => {
    const { client, getBlockNumber, getTransactionReceipt } = fakeClient();
    const fetch = liveFetch();
    const reader = new LiveErc8004Reader(config, { client, fetch });

    const identity = await reader.resolve(reference);
    const inspection = await reader.inspectFeedback(reference);
    const feedback = await reader.listQualityFeedback(reference);
    const raw = assessB1RawReputation({
      feedback,
      scope: {
        agent: identity.agent,
        endpoint: identity.registeredEndpoint,
        tag1: "quality",
        tag2: "inference",
      },
    });

    expect(identity).toMatchObject({
      registeredEndpoint: ENDPOINT,
      observedAtBlock: 500n,
    });
    expect(identity.owner.toLowerCase()).toBe(OWNER);
    expect(identity.agentWallet.toLowerCase()).toBe(AGENT_WALLET);
    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toMatchObject({
      clientAddress: REVIEWER_A,
      isRevoked: false,
      observedAtBlock: 400n,
    });
    expect(feedback[1]).toMatchObject({
      clientAddress: REVIEWER_B,
      isRevoked: true,
    });
    expect(raw.scoreBps).toBe(9_000);
    expect(raw.acceptedFeedback).toHaveLength(1);
    expect(raw.rejectedFeedback[0]?.reason).toBe("REVOKED");
    expect(inspection).toMatchObject({
      status: "VERIFIED",
      onchainFeedbackCount: 2,
      locatorFeedbackCount: 2,
      verifiedReceiptCount: 2,
      issues: [],
    });
    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(2);
  });

  it("returns chain state but suppresses safe scoring when the locator is unavailable", async () => {
    const { client, getTransactionReceipt } = fakeClient();
    const reader = new LiveErc8004Reader(config, {
      client,
      fetch: liveFetch({ indexerStatus: 503 }),
    });

    const inspection = await reader.inspectFeedback(reference);

    expect(inspection).toMatchObject({
      status: "INCOMPLETE",
      onchainFeedbackCount: 2,
      locatorFeedbackCount: 0,
      verifiedReceiptCount: 0,
      issues: [{ code: "INDEXER_UNAVAILABLE" }],
    });
    expect(inspection.feedback).toHaveLength(2);
    expect(inspection.feedback[0]?.endpoint).toBeUndefined();
    await expect(reader.listQualityFeedback(reference)).rejects.toMatchObject({
      code: "FEEDBACK_HISTORY_INCOMPLETE",
    } satisfies Partial<LiveErc8004Error>);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects a registration file that does not self-bind the agent", async () => {
    const { client } = fakeClient();
    const fetch = vi.fn(async () =>
      new Response(
        registration({
          registrations: [
            {
              agentRegistry: `eip155:${reference.chainId}:${IDENTITY_REGISTRY}`,
              agentId: "999",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const reader = new LiveErc8004Reader(config, { client, fetch });

    await expect(reader.resolve(reference)).rejects.toMatchObject({
      code: "REGISTRATION_REFERENCE_MISMATCH",
    } satisfies Partial<LiveErc8004Error>);
  });

  it("rejects a Reputation Registry bound to another Identity Registry", async () => {
    const { client } = fakeClient({
      boundRegistry:
        "0xcccccccccccccccccccccccccccccccccccccccc" as Address,
    });
    const reader = new LiveErc8004Reader(config, {
      client,
      fetch: vi.fn(),
    });

    await expect(reader.resolve(reference)).rejects.toMatchObject({
      code: "IDENTITY_REGISTRY_MISMATCH",
    } satisfies Partial<LiveErc8004Error>);
  });

  it("rejects private registration endpoints before making a request", async () => {
    const { client } = fakeClient();
    const fetch = vi.fn();
    const privateUriClient = {
      ...client,
      readContract: vi.fn(async (request: { functionName: string }) => {
        if (request.functionName === "tokenURI") {
          return "https://127.0.0.1/agent.json";
        }
        if (request.functionName === "ownerOf") return OWNER;
        if (request.functionName === "getAgentWallet") return AGENT_WALLET;
        if (request.functionName === "getIdentityRegistry") {
          return IDENTITY_REGISTRY;
        }
        throw new Error("Unexpected contract call");
      }),
    } as unknown as PublicClient;
    const reader = new LiveErc8004Reader(config, {
      client: privateUriClient,
      fetch,
    });

    await expect(reader.resolve(reference)).rejects.toMatchObject({
      code: "UNSUPPORTED_REGISTRATION_URI",
    } satisfies Partial<LiveErc8004Error>);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-JSON registration responses", async () => {
    const { client } = fakeClient();
    const reader = new LiveErc8004Reader(config, {
      client,
      fetch: vi.fn(async () =>
        new Response(registration(), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });

    await expect(reader.resolve(reference)).rejects.toMatchObject({
      code: "REGISTRATION_FILE_INVALID",
    } satisfies Partial<LiveErc8004Error>);
  });
});
