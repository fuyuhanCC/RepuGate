import { isIP } from "node:net";

import type { Address, AgentReference, Bytes32 } from "@repugate/core";
import { evmAddressSchema } from "@repugate/core";
import { getAddress } from "viem";
import { z } from "zod";

const PAGE_SIZE = 100;
const MAX_FEEDBACK_RECORDS = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const indexedFeedbackSchema = z
  .object({
    chain_id: z.number().int().positive(),
    transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    block_number: z.number().int().nonnegative(),
    user_address: evmAddressSchema,
    feedback_index: z.number().int().positive(),
    agent: z
      .object({
        token_id: z.string().regex(/^(0|[1-9][0-9]*)$/),
        chain_id: z.number().int().positive(),
        registry_address: evmAddressSchema,
      })
      .passthrough(),
  })
  .passthrough();

const feedbackPageSchema = z
  .object({
    items: z.array(indexedFeedbackSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .passthrough();

export interface IndexedFeedbackLocator {
  clientAddress: Address;
  feedbackIndex: bigint;
  transactionHash: Bytes32;
  blockNumber: bigint;
}

export class FeedbackLocatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeedbackLocatorError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
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

function assertPublicHttpsBaseUrl(value: string): URL {
  const url = new URL(value.endsWith("/") ? value : `${value}/`);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipVersion = isIP(hostname);
  const forbiddenIpv6 =
    ipVersion === 6 &&
    (hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb"));

  if (
    url.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (ipVersion === 4 && isPrivateIpv4(hostname)) ||
    forbiddenIpv6
  ) {
    throw new FeedbackLocatorError(
      "The feedback indexer must use a public HTTPS URL",
    );
  }
  return url;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType === undefined ||
    (contentType !== "application/json" && !contentType.endsWith("+json"))
  ) {
    throw new FeedbackLocatorError(
      "The feedback indexer response must use a JSON content type",
    );
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number.parseInt(declaredLength, 10) > MAX_RESPONSE_BYTES
  ) {
    throw new FeedbackLocatorError(
      "The feedback indexer response exceeds the 1 MiB limit",
    );
  }

  if (response.body === null) {
    throw new FeedbackLocatorError(
      "The feedback indexer returned an empty response body",
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new FeedbackLocatorError(
        "The feedback indexer response exceeds the 1 MiB limit",
      );
    }
    body += decoder.decode(result.value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new FeedbackLocatorError(
      "The feedback indexer returned invalid JSON",
      { cause: error },
    );
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function locateIndexedFeedback(
  baseUrl: string,
  reference: AgentReference,
  fetchImpl: typeof globalThis.fetch,
): Promise<readonly IndexedFeedbackLocator[]> {
  const base = assertPublicHttpsBaseUrl(baseUrl);
  const locators: IndexedFeedbackLocator[] = [];
  let offset = 0;
  let total = 0;

  do {
    const url = new URL("feedbacks", base);
    url.searchParams.set("chain_id", reference.chainId.toString());
    url.searchParams.set("agent_token_id", reference.agentId.toString());
    url.searchParams.set("include_revoked", "true");
    url.searchParams.set("limit", PAGE_SIZE.toString());
    url.searchParams.set("offset", offset.toString());

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(7_500),
      });
    } catch (error) {
      throw new FeedbackLocatorError(
        "The feedback indexer could not be reached",
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new FeedbackLocatorError(
        `The feedback indexer returned HTTP ${response.status}`,
      );
    }

    const parsed = feedbackPageSchema.safeParse(
      await readBoundedJson(response),
    );
    if (!parsed.success) {
      throw new FeedbackLocatorError(
        "The feedback indexer response does not match the expected schema",
        { cause: parsed.error },
      );
    }
    total = parsed.data.total;
    if (total > MAX_FEEDBACK_RECORDS) {
      throw new FeedbackLocatorError(
        `The Agent has ${total} indexed feedback records, above the ${MAX_FEEDBACK_RECORDS} inspection limit`,
      );
    }

    for (const item of parsed.data.items) {
      if (
        item.chain_id !== reference.chainId ||
        item.agent.chain_id !== reference.chainId ||
        BigInt(item.agent.token_id) !== reference.agentId ||
        !sameAddress(item.agent.registry_address, reference.registry)
      ) {
        throw new FeedbackLocatorError(
          "The feedback indexer returned an item outside the requested Agent scope",
        );
      }
      locators.push({
        clientAddress: getAddress(item.user_address),
        feedbackIndex: BigInt(item.feedback_index),
        transactionHash: item.transaction_hash.toLowerCase() as Bytes32,
        blockNumber: BigInt(item.block_number),
      });
    }

    offset += parsed.data.items.length;
    if (parsed.data.items.length === 0 && offset < total) {
      throw new FeedbackLocatorError(
        "The feedback indexer pagination ended before the declared total",
      );
    }
  } while (offset < total);

  return locators;
}
