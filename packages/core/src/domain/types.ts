export type Hex = `0x${string}`;

export type Address = Hex;

export type Bytes32 = Hex;

export type EvmNetwork = `eip155:${number}`;

export type HttpMethod = "GET" | "POST";

export interface AgentReference {
  chainId: number;
  registry: Address;
  agentId: bigint;
}

export interface IdentitySnapshot {
  agent: AgentReference;
  owner: Address;
  agentWallet: Address;
  registeredEndpoint: string;
  endpointHash: Bytes32;
  agentUriHash: Bytes32;
  identityEpoch: Bytes32;
  observedAtBlock: bigint;
}

export interface CanonicalOffer {
  method: HttpMethod;
  resourceUrl: string;
  endpointHash: Bytes32;
  requestBodyHash: Bytes32;
  scheme: "exact";
  network: EvmNetwork;
  asset: Address;
  amount: bigint;
  payTo: Address;
  maxTimeoutSeconds: number;
  agent: AgentReference;
}

export interface CanonicalizedOffer {
  offer: CanonicalOffer;
  encodedOffer: Hex;
  offerHash: Bytes32;
}
