import { afterEach, describe, expect, it } from "vitest";

import {
  decodeX402Header,
  encodeX402Header,
  paymentRequiredSchema,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  settlementResponseSchema,
} from "@repugate/x402";
import type { PaymentPayload, PaymentRequired } from "@repugate/x402";

import { buildProviderApp } from "./app";

const BUYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SIGNATURE = `0x${"cd".repeat(65)}`;
const NONCE = `0x${"ef".repeat(32)}`;
const apps: ReturnType<typeof buildProviderApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function app() {
  const instance = buildProviderApp();
  apps.push(instance);
  return instance;
}

function header(
  headers: Record<string, string | number | string[] | undefined>,
  name: string,
): string {
  const value = headers[name.toLowerCase()];
  if (typeof value !== "string") {
    throw new Error(`${name} header is missing`);
  }
  return value;
}

async function requestChallenge(
  instance: ReturnType<typeof buildProviderApp>,
  scenarioId = "honest-service",
) {
  const response = await instance.inject({
    method: "POST",
    url: `/provider/services/${scenarioId}/inference`,
    payload: { task: "summarise" },
  });
  const required = decodeX402Header(
    header(response.headers, PAYMENT_REQUIRED_HEADER),
    paymentRequiredSchema,
  );

  return { required, response };
}

function validPayload(required: PaymentRequired): PaymentPayload {
  const accepted = required.accepts[0]!;
  if (accepted.scheme !== "exact") {
    throw new Error("Test provider did not return an exact payment offer");
  }

  return {
    x402Version: 2,
    resource: required.resource,
    accepted: {
      ...accepted,
      scheme: "exact",
      network: accepted.network as `eip155:${number}`,
      amount: accepted.amount,
      asset: accepted.asset,
      payTo: accepted.payTo,
    },
    payload: {
      signature: SIGNATURE,
      authorization: {
        from: BUYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "1700000000",
        validBefore: "1700000060",
        nonce: NONCE,
      },
    },
    ...(required.extensions === undefined
      ? {}
      : { extensions: required.extensions }),
  };
}

describe("independent x402 demo provider", () => {
  it("returns a structured 402 challenge without a payment payload", async () => {
    const { required, response } = await requestChallenge(app());

    expect(response.statusCode).toBe(402);
    expect(required).toMatchObject({
      x402Version: 2,
      resource: { serviceName: "RepuGate Independent Demo Provider" },
      accepts: [{ scheme: "exact", amount: "10000" }],
    });
    expect(required.extensions?.["repugate-agent"]?.info).toBeDefined();
  });

  it("accepts an exactly matching payload and reports simulated settlement", async () => {
    const instance = app();
    const { required } = await requestChallenge(instance);
    const response = await instance.inject({
      method: "POST",
      url: "/provider/services/honest-service/inference",
      headers: {
        [PAYMENT_SIGNATURE_HEADER]: encodeX402Header(validPayload(required)),
      },
      payload: { task: "summarise" },
    });
    const settlement = decodeX402Header(
      header(response.headers, PAYMENT_RESPONSE_HEADER),
      settlementResponseSchema,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scenario: "honest-service",
      providerBehaviour: "HONEST",
      settlement: "simulated",
    });
    expect(settlement).toMatchObject({
      success: true,
      payer: BUYER,
      amount: "10000",
      extensions: { settlement: "simulated" },
    });
  });

  it("rejects a payload whose authorization differs from the selected offer", async () => {
    const instance = app();
    const { required } = await requestChallenge(instance);
    const payload = validPayload(required);
    payload.payload.authorization.value = "9999";
    const response = await instance.inject({
      method: "POST",
      url: "/provider/services/honest-service/inference",
      headers: {
        [PAYMENT_SIGNATURE_HEADER]: encodeX402Header(payload),
      },
      payload: { task: "summarise" },
    });

    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({ code: "AUTHORIZATION_MISMATCH" });
    expect(response.headers[PAYMENT_RESPONSE_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("exposes offer substitution as an explicit provider behaviour", async () => {
    const { required, response } = await requestChallenge(
      app(),
      "offer-substitution",
    );

    expect(response.statusCode).toBe(402);
    expect(required.accepts[0]).toMatchObject({ amount: "20000" });
  });

  it("rejects unknown scenarios and reports provider health", async () => {
    const instance = app();
    const missing = await instance.inject({
      method: "POST",
      url: "/provider/services/not-a-scenario/inference",
    });
    const health = await instance.inject({
      method: "GET",
      url: "/provider/health",
    });

    expect(missing.statusCode).toBe(404);
    expect(health.json()).toEqual({ status: "ok", settlement: "simulated" });
  });
});
