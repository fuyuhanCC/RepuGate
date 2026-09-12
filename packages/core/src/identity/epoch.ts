import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  stringToHex,
} from "viem";

import { canonicalizeHttpUrl } from "../canonicalization/http-url";
import type { Bytes32, IdentitySnapshot } from "../domain/types";
import {
  identitySnapshotInputSchema,
  type IdentitySnapshotInput,
} from "../schemas/identity";

const IDENTITY_EPOCH_ABI = [
  { name: "identityChainId", type: "uint256" },
  { name: "agentRegistry", type: "address" },
  { name: "agentId", type: "uint256" },
  { name: "owner", type: "address" },
  { name: "agentWallet", type: "address" },
  { name: "agentUriHash", type: "bytes32" },
  { name: "endpointHash", type: "bytes32" },
] as const;

export function deriveIdentityEpoch(
  input: IdentitySnapshotInput,
): IdentitySnapshot {
  const parsed = identitySnapshotInputSchema.parse(input);
  const registeredEndpoint = canonicalizeHttpUrl(parsed.registeredEndpoint);
  const endpointHash = keccak256(stringToHex(registeredEndpoint));

  const snapshotWithoutEpoch = {
    agent: {
      chainId: parsed.agent.chainId,
      registry: getAddress(parsed.agent.registry),
      agentId: BigInt(parsed.agent.agentId),
    },
    owner: getAddress(parsed.owner),
    agentWallet: getAddress(parsed.agentWallet),
    registeredEndpoint,
    endpointHash,
    agentUriHash: parsed.agentUriHash as Bytes32,
    observedAtBlock: BigInt(parsed.observedAtBlock),
  };

  const encodedEpoch = encodeAbiParameters(IDENTITY_EPOCH_ABI, [
    BigInt(snapshotWithoutEpoch.agent.chainId),
    snapshotWithoutEpoch.agent.registry,
    snapshotWithoutEpoch.agent.agentId,
    snapshotWithoutEpoch.owner,
    snapshotWithoutEpoch.agentWallet,
    snapshotWithoutEpoch.agentUriHash,
    snapshotWithoutEpoch.endpointHash,
  ]);

  return {
    ...snapshotWithoutEpoch,
    identityEpoch: keccak256(encodedEpoch),
  };
}
