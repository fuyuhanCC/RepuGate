import type {
  Address,
  AgentReference,
  FeedbackReader,
  IdentityReader,
} from "@repugate/core";
import { evmAddressSchema, positiveIntegerStringSchema } from "@repugate/core";
import { createPublicClient, http } from "viem";
import { z } from "zod";

import {
  LiveErc8004Reader,
  type LiveErc8004ReaderConfig,
} from "../adapters/erc8004/live-reader";

const enabledSchema = z.enum(["true", "false"]).default("false");
const safePositiveIntegerSchema = positiveIntegerStringSchema.refine(
  (value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  "Expected a positive safe integer",
);
const liveEnvironmentSchema = z.object({
  REPUGATE_LIVE_ERC8004: enabledSchema,
  ERC8004_CHAIN_ID: safePositiveIntegerSchema.optional(),
  ERC8004_RPC_URL: z.string().url().optional(),
  ERC8004_IDENTITY_REGISTRY: evmAddressSchema.optional(),
  ERC8004_REPUTATION_REGISTRY: evmAddressSchema.optional(),
  ERC8004_AGENT_ID: positiveIntegerStringSchema.optional(),
  ERC8004_SERVICE_ENDPOINT: z.string().url().optional(),
  ERC8004_FEEDBACK_FROM_BLOCK: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .optional(),
  ERC8004_IPFS_GATEWAY: z.string().url().optional(),
});

export interface LiveErc8004Runtime {
  config: LiveErc8004ReaderConfig;
  reference: AgentReference;
  createReader(): IdentityReader & FeedbackReader;
}

function requiredValue(value: string | undefined, key: string): string {
  if (value === undefined) {
    throw new Error(`${key} is required when REPUGATE_LIVE_ERC8004=true`);
  }
  return value;
}

export function loadLiveErc8004Runtime(
  environment: NodeJS.ProcessEnv,
): LiveErc8004Runtime | undefined {
  const enabled = enabledSchema.parse(environment.REPUGATE_LIVE_ERC8004);
  if (enabled === "false") {
    return undefined;
  }
  const parsed = liveEnvironmentSchema.parse(environment);

  const chainId = requiredValue(parsed.ERC8004_CHAIN_ID, "ERC8004_CHAIN_ID");
  const rpcUrl = requiredValue(parsed.ERC8004_RPC_URL, "ERC8004_RPC_URL");
  const identityRegistry = requiredValue(
    parsed.ERC8004_IDENTITY_REGISTRY,
    "ERC8004_IDENTITY_REGISTRY",
  );
  const reputationRegistry = requiredValue(
    parsed.ERC8004_REPUTATION_REGISTRY,
    "ERC8004_REPUTATION_REGISTRY",
  );
  const agentId = requiredValue(parsed.ERC8004_AGENT_ID, "ERC8004_AGENT_ID");
  const serviceEndpoint = requiredValue(
    parsed.ERC8004_SERVICE_ENDPOINT,
    "ERC8004_SERVICE_ENDPOINT",
  );
  const feedbackFromBlock = requiredValue(
    parsed.ERC8004_FEEDBACK_FROM_BLOCK,
    "ERC8004_FEEDBACK_FROM_BLOCK",
  );

  const config: LiveErc8004ReaderConfig = {
    chainId: Number(chainId),
    identityRegistry: identityRegistry as Address,
    reputationRegistry: reputationRegistry as Address,
    serviceEndpoint,
    feedbackFromBlock: BigInt(feedbackFromBlock),
    ...(parsed.ERC8004_IPFS_GATEWAY === undefined
      ? {}
      : { ipfsGateway: parsed.ERC8004_IPFS_GATEWAY }),
  };
  const reference: AgentReference = {
    chainId: config.chainId,
    registry: config.identityRegistry,
    agentId: BigInt(agentId),
  };
  const client = createPublicClient({ transport: http(rpcUrl) });

  return {
    config,
    reference,
    createReader() {
      return new LiveErc8004Reader(config, { client });
    },
  };
}
