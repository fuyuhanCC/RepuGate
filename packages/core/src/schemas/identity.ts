import { z } from "zod";

import {
  agentReferenceInputSchema,
  bytes32Schema,
  evmAddressSchema,
  httpResourceUrlSchema,
  unsignedIntegerStringSchema,
} from "./offer";

export const identitySnapshotInputSchema = z
  .object({
    agent: agentReferenceInputSchema,
    owner: evmAddressSchema,
    agentWallet: evmAddressSchema,
    registeredEndpoint: httpResourceUrlSchema,
    agentUriHash: bytes32Schema,
    observedAtBlock: unsignedIntegerStringSchema,
  })
  .strict();

export type IdentitySnapshotInput = z.infer<
  typeof identitySnapshotInputSchema
>;
