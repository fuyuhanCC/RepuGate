import { isIP } from "node:net";

import type {
  Address,
  AgentReference,
  FeedbackReader,
  FeedbackRecord,
  IdentityReader,
  IdentitySnapshot,
} from "@repugate/core";
import {
  canonicalizeHttpUrl,
  deriveIdentityEpoch,
  normalizeFeedbackRecord,
} from "@repugate/core";
import type { PublicClient } from "viem";
import {
  decodeEventLog,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
} from "viem";
import { z } from "zod";

import {
  identityRegistryAbi,
  newFeedbackEvent,
  reputationRegistryAbi,
} from "./abi";
import {
  FeedbackLocatorError,
  locateIndexedFeedback,
  type IndexedFeedbackLocator,
} from "./8004scan-locator";

const MAX_REGISTRATION_BYTES = 256 * 1024;
const MAX_LIVE_FEEDBACK_RECORDS = 500;

const registrationServiceSchema = z
  .object({
    name: z.string().min(1).max(128),
    endpoint: z.string().min(1).max(2_048),
  })
  .passthrough();

const registrationReferenceSchema = z
  .object({
    agentRegistry: z.string().min(1).max(256),
    agentId: z.union([
      z.string().regex(/^(0|[1-9][0-9]*)$/),
      z.number().int().nonnegative().safe(),
    ]),
  })
  .passthrough();

const registrationFileSchema = z
  .object({
    services: z.array(registrationServiceSchema).min(1).max(100),
    registrations: z.array(registrationReferenceSchema).min(1).max(100),
  })
  .passthrough();

export type LiveErc8004ErrorCode =
  | "CHAIN_MISMATCH"
  | "IDENTITY_REFERENCE_MISMATCH"
  | "IDENTITY_REGISTRY_MISMATCH"
  | "FEEDBACK_HISTORY_INCOMPLETE"
  | "FEEDBACK_STATE_INVALID"
  | "FEEDBACK_STATE_READ_FAILED"
  | "REGISTRATION_FETCH_FAILED"
  | "REGISTRATION_FILE_INVALID"
  | "REGISTRATION_REFERENCE_MISMATCH"
  | "SERVICE_ENDPOINT_MISMATCH"
  | "UNSUPPORTED_REGISTRATION_URI"
  | "UNVERIFIED_AGENT_WALLET";

export class LiveErc8004Error extends Error {
  constructor(
    public readonly code: LiveErc8004ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveErc8004Error";
  }
}

export interface LiveErc8004ReaderConfig {
  chainId: number;
  identityRegistry: Address;
  reputationRegistry: Address;
  serviceEndpoint: string;
  feedbackIndexerUrl: string;
  ipfsGateway?: string;
}

export interface LiveErc8004ReaderDependencies {
  client: PublicClient;
  fetch?: typeof globalThis.fetch;
}

export type LiveFeedbackIssueCode =
  | "INDEXER_UNAVAILABLE"
  | "LOCATOR_DUPLICATE"
  | "LOCATOR_EXTRA"
  | "LOCATOR_MISSING"
  | "RECEIPT_EVENT_MISMATCH"
  | "RECEIPT_UNAVAILABLE";

export interface LiveFeedbackIssue {
  code: LiveFeedbackIssueCode;
  feedbackKey?: string;
}

export interface LiveFeedbackInspection {
  feedback: readonly FeedbackRecord[];
  status: "VERIFIED" | "INCOMPLETE";
  onchainFeedbackCount: number;
  locatorFeedbackCount: number;
  verifiedReceiptCount: number;
  issues: readonly LiveFeedbackIssue[];
}

export interface LiveErc8004Inspector extends IdentityReader, FeedbackReader {
  inspectFeedback(reference: AgentReference): Promise<LiveFeedbackInspection>;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameReference(
  reference: AgentReference,
  config: LiveErc8004ReaderConfig,
): boolean {
  return (
    reference.chainId === config.chainId &&
    sameAddress(reference.registry, config.identityRegistry)
  );
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isForbiddenRegistrationHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return privateIpv4(normalized);
  }
  if (ipVersion === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return false;
}

function ipfsToGateway(uri: string, gateway: string | undefined): string {
  if (gateway === undefined) {
    throw new LiveErc8004Error(
      "UNSUPPORTED_REGISTRATION_URI",
      "The agent uses an IPFS registration URI but no HTTPS IPFS gateway is configured",
    );
  }

  const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  if (path.length === 0) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration IPFS URI is empty",
    );
  }

  const base = new URL(canonicalizeHttpUrl(gateway));
  if (base.protocol !== "https:") {
    throw new LiveErc8004Error(
      "UNSUPPORTED_REGISTRATION_URI",
      "The IPFS gateway must use HTTPS",
    );
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/ipfs/${path}`;
  return base.toString();
}

function decodeDataRegistration(uri: string): string {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) {
    throw new LiveErc8004Error(
      "UNSUPPORTED_REGISTRATION_URI",
      "Only HTTPS, IPFS, and base64 JSON data registration URIs are supported",
    );
  }

  const bytes = Buffer.from(uri.slice(prefix.length), "base64");
  if (bytes.byteLength > MAX_REGISTRATION_BYTES) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration file exceeds the 256 KiB limit",
    );
  }
  return bytes.toString("utf8");
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.parseInt(declaredLength, 10) > MAX_REGISTRATION_BYTES
  ) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration file exceeds the 256 KiB limit",
    );
  }

  if (response.body === null) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REGISTRATION_BYTES) {
      throw new LiveErc8004Error(
        "REGISTRATION_FILE_INVALID",
        "The agent registration file exceeds the 256 KiB limit",
      );
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_REGISTRATION_BYTES) {
      await reader.cancel();
      throw new LiveErc8004Error(
        "REGISTRATION_FILE_INVALID",
        "The agent registration file exceeds the 256 KiB limit",
      );
    }
    body += decoder.decode(result.value, { stream: true });
  }
  return body + decoder.decode();
}

async function fetchRegistrationFile(
  agentUri: string,
  config: LiveErc8004ReaderConfig,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  if (agentUri.startsWith("data:")) {
    return decodeDataRegistration(agentUri);
  }

  const resolvedUri = agentUri.startsWith("ipfs://")
    ? ipfsToGateway(agentUri, config.ipfsGateway)
    : agentUri;
  let url: URL;
  try {
    url = new URL(resolvedUri);
  } catch (error) {
    throw new LiveErc8004Error(
      "UNSUPPORTED_REGISTRATION_URI",
      "The agent registration URI is not a valid URL",
      { cause: error },
    );
  }
  if (url.protocol !== "https:" || isForbiddenRegistrationHost(url.hostname)) {
    throw new LiveErc8004Error(
      "UNSUPPORTED_REGISTRATION_URI",
      "The agent registration URI must be a public HTTPS URL",
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new LiveErc8004Error(
      "REGISTRATION_FETCH_FAILED",
      "The agent registration file could not be fetched",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new LiveErc8004Error(
      "REGISTRATION_FETCH_FAILED",
      `The agent registration server returned HTTP ${response.status}`,
    );
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType === undefined ||
    (contentType !== "application/json" && !contentType.endsWith("+json"))
  ) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration response must use a JSON content type",
    );
  }

  return readLimitedBody(response);
}

function registrationMatchesReference(
  value: z.infer<typeof registrationReferenceSchema>,
  reference: AgentReference,
): boolean {
  const expectedPrefix = `eip155:${reference.chainId}:`;
  if (!value.agentRegistry.toLowerCase().startsWith(expectedPrefix)) {
    return false;
  }

  const registry = value.agentRegistry.slice(expectedPrefix.length);
  return (
    sameAddress(registry, reference.registry) &&
    BigInt(value.agentId) === reference.agentId
  );
}

function parseRegistration(
  raw: string,
  reference: AgentReference,
  configuredEndpoint: string,
): { endpoint: string; contentHash: `0x${string}` } {
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration file is not valid JSON",
      { cause: error },
    );
  }

  const parsed = registrationFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new LiveErc8004Error(
      "REGISTRATION_FILE_INVALID",
      "The agent registration file does not match the required ERC-8004 shape",
      { cause: parsed.error },
    );
  }
  if (
    !parsed.data.registrations.some((item) =>
      registrationMatchesReference(item, reference),
    )
  ) {
    throw new LiveErc8004Error(
      "REGISTRATION_REFERENCE_MISMATCH",
      "The registration file does not bind itself to the requested onchain agent",
    );
  }

  const expectedEndpoint = canonicalizeHttpUrl(configuredEndpoint);
  const matchingService = parsed.data.services.find((service) => {
    try {
      return canonicalizeHttpUrl(service.endpoint) === expectedEndpoint;
    } catch {
      return false;
    }
  });
  if (matchingService === undefined) {
    throw new LiveErc8004Error(
      "SERVICE_ENDPOINT_MISMATCH",
      "The configured service endpoint is not advertised by the agent registration file",
    );
  }

  return {
    endpoint: expectedEndpoint,
    contentHash: keccak256(toHex(raw)),
  };
}

function feedbackRecordKey(clientAddress: string, feedbackIndex: bigint): string {
  return `${clientAddress.toLowerCase()}:${feedbackIndex}`;
}

type StoredFeedbackTuple = readonly [
  readonly Address[],
  readonly bigint[],
  readonly bigint[],
  readonly number[],
  readonly string[],
  readonly string[],
  readonly boolean[],
];

function parseStoredFeedback(
  value: StoredFeedbackTuple,
  reference: AgentReference,
  observedAtBlock: bigint,
): FeedbackRecord[] {
  const [
    clients,
    feedbackIndexes,
    values,
    valueDecimals,
    tag1s,
    tag2s,
    revokedStatuses,
  ] = value;
  const lengths = [
    clients.length,
    feedbackIndexes.length,
    values.length,
    valueDecimals.length,
    tag1s.length,
    tag2s.length,
    revokedStatuses.length,
  ];
  if (lengths.some((length) => length !== clients.length)) {
    throw new LiveErc8004Error(
      "FEEDBACK_STATE_INVALID",
      "The Reputation Registry returned inconsistent feedback arrays",
    );
  }
  if (clients.length > MAX_LIVE_FEEDBACK_RECORDS) {
    throw new LiveErc8004Error(
      "FEEDBACK_STATE_INVALID",
      `The Agent has more than ${MAX_LIVE_FEEDBACK_RECORDS} feedback records, above the Live Inspector limit`,
    );
  }

  return clients.map((clientAddress, index) =>
    normalizeFeedbackRecord({
      agent: {
        chainId: reference.chainId,
        registry: reference.registry,
        agentId: reference.agentId.toString(),
      },
      clientAddress,
      feedbackIndex: feedbackIndexes[index]!.toString(),
      value: values[index]!.toString(),
      valueDecimals: valueDecimals[index]!,
      tag1: tag1s[index]!,
      tag2: tag2s[index]!,
      isRevoked: revokedStatuses[index]!,
      observedAtBlock: observedAtBlock.toString(),
    }),
  );
}

function eventMatchesStoredFeedback(
  args: {
    agentId: bigint;
    clientAddress: Address;
    feedbackIndex: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
  },
  stored: FeedbackRecord,
): boolean {
  return (
    args.agentId === stored.agent.agentId &&
    sameAddress(args.clientAddress, stored.clientAddress) &&
    args.feedbackIndex === stored.feedbackIndex &&
    args.value === stored.value &&
    args.valueDecimals === stored.valueDecimals &&
    args.tag1 === stored.tag1 &&
    args.tag2 === stored.tag2
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

interface FeedbackWithLocator {
  stored: FeedbackRecord;
  locator: IndexedFeedbackLocator;
}

interface ReceiptVerificationResult {
  feedback: FeedbackRecord;
  issue?: LiveFeedbackIssue;
}

export class LiveErc8004Reader implements LiveErc8004Inspector {
  private snapshotBlockPromise: Promise<bigint> | undefined;
  private feedbackInspectionPromise: Promise<LiveFeedbackInspection> | undefined;

  constructor(
    private readonly config: LiveErc8004ReaderConfig,
    private readonly dependencies: LiveErc8004ReaderDependencies,
  ) {}

  private async snapshotBlock(): Promise<bigint> {
    this.snapshotBlockPromise ??= (async () => {
      const chainId = await this.dependencies.client.getChainId();
      if (chainId !== this.config.chainId) {
        throw new LiveErc8004Error(
          "CHAIN_MISMATCH",
          `RPC reports chain ${chainId}, expected ${this.config.chainId}`,
        );
      }
      return this.dependencies.client.getBlockNumber();
    })();
    return this.snapshotBlockPromise;
  }

  private assertReference(reference: AgentReference): void {
    if (!sameReference(reference, this.config)) {
      throw new LiveErc8004Error(
        "IDENTITY_REFERENCE_MISMATCH",
        "The requested agent does not match the configured live ERC-8004 registry",
      );
    }
  }

  async resolve(reference: AgentReference): Promise<IdentitySnapshot> {
    this.assertReference(reference);
    const blockNumber = await this.snapshotBlock();
    const [owner, agentWallet, agentUri, boundIdentityRegistry] =
      await Promise.all([
        this.dependencies.client.readContract({
          address: this.config.identityRegistry,
          abi: identityRegistryAbi,
          functionName: "ownerOf",
          args: [reference.agentId],
          blockNumber,
        }),
        this.dependencies.client.readContract({
          address: this.config.identityRegistry,
          abi: identityRegistryAbi,
          functionName: "getAgentWallet",
          args: [reference.agentId],
          blockNumber,
        }),
        this.dependencies.client.readContract({
          address: this.config.identityRegistry,
          abi: identityRegistryAbi,
          functionName: "tokenURI",
          args: [reference.agentId],
          blockNumber,
        }),
        this.dependencies.client.readContract({
          address: this.config.reputationRegistry,
          abi: reputationRegistryAbi,
          functionName: "getIdentityRegistry",
          blockNumber,
        }),
      ]);

    if (!sameAddress(boundIdentityRegistry, this.config.identityRegistry)) {
      throw new LiveErc8004Error(
        "IDENTITY_REGISTRY_MISMATCH",
        "The configured Reputation Registry is bound to another Identity Registry",
      );
    }
    if (sameAddress(agentWallet, zeroAddress)) {
      throw new LiveErc8004Error(
        "UNVERIFIED_AGENT_WALLET",
        "The live agent has no verified agentWallet",
      );
    }

    const rawRegistration = await fetchRegistrationFile(
      agentUri,
      this.config,
      this.dependencies.fetch ?? globalThis.fetch,
    );
    const registration = parseRegistration(
      rawRegistration,
      reference,
      this.config.serviceEndpoint,
    );

    return deriveIdentityEpoch({
      agent: {
        chainId: reference.chainId,
        registry: getAddress(reference.registry),
        agentId: reference.agentId.toString(),
      },
      owner: getAddress(owner),
      agentWallet: getAddress(agentWallet),
      registeredEndpoint: registration.endpoint,
      agentUriHash: registration.contentHash,
      observedAtBlock: blockNumber.toString(),
    });
  }

  private async verifyReceipt(
    item: FeedbackWithLocator,
    snapshotBlock: bigint,
  ): Promise<ReceiptVerificationResult> {
    const feedbackKey = feedbackRecordKey(
      item.stored.clientAddress,
      item.stored.feedbackIndex,
    );
    try {
      const receipt = await this.dependencies.client.getTransactionReceipt({
        hash: item.locator.transactionHash,
      });
      if (
        receipt.status !== "success" ||
        receipt.blockNumber > snapshotBlock ||
        receipt.blockNumber !== item.locator.blockNumber
      ) {
        return {
          feedback: item.stored,
          issue: { code: "RECEIPT_EVENT_MISMATCH", feedbackKey },
        };
      }

      const matchingEvents = receipt.logs.flatMap((log) => {
        if (!sameAddress(log.address, this.config.reputationRegistry)) {
          return [];
        }
        try {
          const decoded = decodeEventLog({
            abi: [newFeedbackEvent],
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          if (
            decoded.eventName !== "NewFeedback" ||
            !eventMatchesStoredFeedback(decoded.args, item.stored)
          ) {
            return [];
          }
          return [decoded.args];
        } catch {
          return [];
        }
      });
      if (matchingEvents.length !== 1) {
        return {
          feedback: item.stored,
          issue: { code: "RECEIPT_EVENT_MISMATCH", feedbackKey },
        };
      }

      const event = matchingEvents[0]!;
      return {
        feedback: normalizeFeedbackRecord({
          agent: {
            chainId: item.stored.agent.chainId,
            registry: item.stored.agent.registry,
            agentId: item.stored.agent.agentId.toString(),
          },
          clientAddress: event.clientAddress,
          feedbackIndex: event.feedbackIndex.toString(),
          value: event.value.toString(),
          valueDecimals: event.valueDecimals,
          tag1: event.tag1,
          tag2: event.tag2,
          ...(event.endpoint === "" ? {} : { endpoint: event.endpoint }),
          ...(event.feedbackURI === ""
            ? {}
            : { feedbackUri: event.feedbackURI }),
          feedbackHash: event.feedbackHash,
          isRevoked: item.stored.isRevoked,
          observedAtBlock: receipt.blockNumber.toString(),
        }),
      };
    } catch {
      return {
        feedback: item.stored,
        issue: { code: "RECEIPT_UNAVAILABLE", feedbackKey },
      };
    }
  }

  async inspectFeedback(
    reference: AgentReference,
  ): Promise<LiveFeedbackInspection> {
    this.assertReference(reference);
    this.feedbackInspectionPromise ??= (async () => {
      const blockNumber = await this.snapshotBlock();
      let storedTuple: StoredFeedbackTuple;
      try {
        storedTuple = await this.dependencies.client.readContract({
          address: this.config.reputationRegistry,
          abi: reputationRegistryAbi,
          functionName: "readAllFeedback",
          args: [reference.agentId, [], "", "", true],
          blockNumber,
        });
      } catch (error) {
        throw new LiveErc8004Error(
          "FEEDBACK_STATE_READ_FAILED",
          "The Reputation Registry feedback state could not be read",
          { cause: error },
        );
      }

      const storedFeedback = parseStoredFeedback(
        storedTuple,
        reference,
        blockNumber,
      );
      let locators: readonly IndexedFeedbackLocator[];
      try {
        locators = await locateIndexedFeedback(
          this.config.feedbackIndexerUrl,
          reference,
          this.dependencies.fetch ?? globalThis.fetch,
        );
      } catch (error) {
        if (!(error instanceof FeedbackLocatorError)) throw error;
        return {
          feedback: storedFeedback,
          status: "INCOMPLETE",
          onchainFeedbackCount: storedFeedback.length,
          locatorFeedbackCount: 0,
          verifiedReceiptCount: 0,
          issues: [{ code: "INDEXER_UNAVAILABLE" }],
        };
      }

      const issues: LiveFeedbackIssue[] = [];
      const storedByKey = new Map(
        storedFeedback.map((item) => [
          feedbackRecordKey(item.clientAddress, item.feedbackIndex),
          item,
        ]),
      );
      const locatorsByKey = new Map<string, IndexedFeedbackLocator[]>();
      for (const locator of locators) {
        const key = feedbackRecordKey(
          locator.clientAddress,
          locator.feedbackIndex,
        );
        if (!storedByKey.has(key)) {
          issues.push({ code: "LOCATOR_EXTRA", feedbackKey: key });
          continue;
        }
        const group = locatorsByKey.get(key) ?? [];
        group.push(locator);
        locatorsByKey.set(key, group);
      }

      const verifiable: FeedbackWithLocator[] = [];
      for (const stored of storedFeedback) {
        const key = feedbackRecordKey(
          stored.clientAddress,
          stored.feedbackIndex,
        );
        const candidates = locatorsByKey.get(key) ?? [];
        if (candidates.length === 0) {
          issues.push({ code: "LOCATOR_MISSING", feedbackKey: key });
        } else if (candidates.length > 1) {
          issues.push({ code: "LOCATOR_DUPLICATE", feedbackKey: key });
        } else {
          verifiable.push({ stored, locator: candidates[0]! });
        }
      }

      const verified = await mapWithConcurrency(
        verifiable,
        4,
        (item) => this.verifyReceipt(item, blockNumber),
      );
      const verifiedByKey = new Map<string, FeedbackRecord>();
      for (const result of verified) {
        if (result.issue !== undefined) {
          issues.push(result.issue);
          continue;
        }
        verifiedByKey.set(
          feedbackRecordKey(
            result.feedback.clientAddress,
            result.feedback.feedbackIndex,
          ),
          result.feedback,
        );
      }
      const feedback = storedFeedback.map(
        (stored) =>
          verifiedByKey.get(
            feedbackRecordKey(stored.clientAddress, stored.feedbackIndex),
          ) ?? stored,
      );

      return {
        feedback,
        status: issues.length === 0 ? "VERIFIED" : "INCOMPLETE",
        onchainFeedbackCount: storedFeedback.length,
        locatorFeedbackCount: locators.length,
        verifiedReceiptCount: verifiedByKey.size,
        issues,
      };
    })();

    return this.feedbackInspectionPromise;
  }

  async listQualityFeedback(
    reference: AgentReference,
  ): Promise<readonly FeedbackRecord[]> {
    const inspection = await this.inspectFeedback(reference);
    if (inspection.status !== "VERIFIED") {
      throw new LiveErc8004Error(
        "FEEDBACK_HISTORY_INCOMPLETE",
        "Live feedback history is incomplete and cannot be scored safely",
      );
    }
    return inspection.feedback;
  }
}
