import { describe, expect, it, vi } from "vitest";

import type { Address, AgentReference } from "@repugate/core";
import { assessB1RawReputation } from "@repugate/core";
import type { PublicClient } from "viem";

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
  feedbackFromBlock: 100n,
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
      default:
        throw new Error(`Unexpected contract call: ${request.functionName}`);
    }
  });
  const getLogs = vi.fn(async (request: { event: { name: string } }) => {
    if (request.event.name === "FeedbackRevoked") {
      return [
        {
          args: {
            agentId: 12n,
            clientAddress: REVIEWER_B,
            feedbackIndex: 1n,
          },
          blockNumber: 450n,
        },
      ];
    }

    return [
      {
        args: {
          agentId: 12n,
          clientAddress: REVIEWER_A,
          feedbackIndex: 1n,
          value: 90n,
          valueDecimals: 0,
          indexedTag1: ZERO_HASH,
          tag1: "quality",
          tag2: "inference",
          endpoint: ENDPOINT,
          feedbackURI: "",
          feedbackHash: ZERO_HASH,
        },
        blockNumber: 400n,
      },
      {
        args: {
          agentId: 12n,
          clientAddress: REVIEWER_B,
          feedbackIndex: 1n,
          value: 100n,
          valueDecimals: 0,
          indexedTag1: ZERO_HASH,
          tag1: "quality",
          tag2: "inference",
          endpoint: ENDPOINT,
          feedbackURI: "",
          feedbackHash: ZERO_HASH,
        },
        blockNumber: 420n,
      },
    ];
  });
  const client = {
    getChainId: vi.fn(async () => reference.chainId),
    getBlockNumber,
    readContract,
    getLogs,
  } as unknown as PublicClient;

  return { client, getBlockNumber, getLogs };
}

describe("LiveErc8004Reader", () => {
  it("loads identity and feedback from one deterministic RPC snapshot", async () => {
    const { client, getBlockNumber, getLogs } = fakeClient();
    const fetch = vi.fn(async () =>
      new Response(registration(), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const reader = new LiveErc8004Reader(config, { client, fetch });

    const identity = await reader.resolve(reference);
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
    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledTimes(2);
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
