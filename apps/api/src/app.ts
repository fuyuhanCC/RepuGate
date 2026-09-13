import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  assessB1RawReputation,
  canonicalizeOffer,
  createDeterministicScenario,
  DETERMINISTIC_SCENARIO_IDS,
  HttpUrlCanonicalizationError,
  OfferCanonicalizationError,
} from "@repugate/core";
import type {
  Address,
  Bytes32,
  DeterministicScenarioId,
} from "@repugate/core";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { ApplicationError } from "./application/errors";
import { LiveErc8004Error } from "./adapters/erc8004/live-reader";
import type {
  ClientPaymentEventRequest,
  ConsumeGrantRequest,
  EvaluationRequest,
  IdGenerator,
} from "./application/service";
import { RepuGateService } from "./application/service";
import type { LiveErc8004Runtime } from "./config/live-erc8004";
import { ApiDatabase } from "./database/database";
import {
  clientPaymentEventRequestSchema,
  consumeGrantRequestSchema,
  decisionParamsSchema,
  evaluationRequestSchema,
  grantParamsSchema,
  paymentParamsSchema,
} from "./http/schemas";
import { toJsonCompatible } from "./serialization/json";

export interface BuildAppOptions {
  databasePath?: string;
  grantLifetimeSeconds?: number;
  idGenerator?: IdGenerator;
  liveErc8004?: LiveErc8004Runtime;
  logger?: boolean;
  now?: () => number;
}

const defaultIdGenerator: IdGenerator = {
  next(prefix) {
    return `${prefix}_${randomUUID()}`;
  },
};

function defaultNow(): number {
  return Math.floor(Date.now() / 1_000);
}

function scenarioId(value: string): DeterministicScenarioId {
  if (
    !(DETERMINISTIC_SCENARIO_IDS as readonly string[]).includes(value)
  ) {
    throw new ApplicationError(
      "SCENARIO_NOT_FOUND",
      "Deterministic scenario was not found",
      404,
    );
  }

  return value as DeterministicScenarioId;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const database = new ApiDatabase(
    options.databasePath ?? resolve(process.cwd(), "var/demo.sqlite"),
  );
  const service = new RepuGateService({
    database,
    idGenerator: options.idGenerator ?? defaultIdGenerator,
    now: options.now ?? defaultNow,
    grantLifetimeSeconds: options.grantLifetimeSeconds ?? 60,
    resolveEvaluationPorts(id, model) {
      return createDeterministicScenario(scenarioId(id), model).ports;
    },
  });

  app.addHook("onClose", async () => {
    database.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        retryable: false,
        details: { issues: error.issues },
      });
    }

    if (error instanceof ApplicationError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }

    if (error instanceof LiveErc8004Error) {
      return reply.status(502).send({
        code: `LIVE_ERC8004_${error.code}`,
        message: error.message,
        retryable: true,
      });
    }

    if (
      error instanceof OfferCanonicalizationError ||
      error instanceof HttpUrlCanonicalizationError
    ) {
      return reply.status(400).send({
        code: "UNSUPPORTED_OFFER",
        message: error.message,
        retryable: false,
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
      retryable: false,
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/live/erc8004", async () => {
    if (options.liveErc8004 === undefined) {
      return {
        enabled: false,
        source: "disabled",
        fixtureMode: "available",
      };
    }

    const reader = options.liveErc8004.createReader();
    const identity = await reader.resolve(options.liveErc8004.reference);
    const feedback = await reader.listQualityFeedback(
      options.liveErc8004.reference,
    );
    const assessment = assessB1RawReputation({
      feedback,
      scope: {
        agent: identity.agent,
        endpoint: identity.registeredEndpoint,
        tag1: "quality",
      },
    });

    return toJsonCompatible({
      enabled: true,
      source: "live-rpc",
      fixtureMode: "available",
      model: "B1_RAW",
      chainId: options.liveErc8004.config.chainId,
      identityRegistry: options.liveErc8004.config.identityRegistry,
      reputationRegistry: options.liveErc8004.config.reputationRegistry,
      feedbackFromBlock:
        options.liveErc8004.config.feedbackFromBlock.toString(),
      identity,
      feedbackCount: feedback.length,
      rawScoreBps: assessment.scoreBps,
      confidenceBps: assessment.confidenceBps,
      distinctReviewerCount: assessment.distinctReviewerCount,
      eligibleFeedbackCount: assessment.acceptedFeedback.length,
      rejectedFeedbackCount: assessment.rejectedFeedback.length,
      riskFlags: assessment.riskFlags,
    });
  });

  app.get("/api/services", async () => {
    return {
      services: DETERMINISTIC_SCENARIO_IDS.map((id) => {
        const scenario = createDeterministicScenario(id, "B3_REPUGATE");
        return toJsonCompatible({
          id,
          title: scenario.title,
          description: scenario.description,
          offer: scenario.input.offer,
          expectedOffer: scenario.expectedOffer,
          expectedOfferHash:
            scenario.input.expectedOfferHash ??
            canonicalizeOffer(scenario.input.offer).offerHash,
        });
      }),
    };
  });

  app.post("/api/evaluations", async (request, reply) => {
    const body = evaluationRequestSchema.parse(request.body);
    const result = await service.evaluateAndIssueGrant({
      ...body,
      buyer: body.buyer as Address,
      expectedOfferHash: body.expectedOfferHash as Bytes32,
    } satisfies EvaluationRequest);
    return reply.status(201).send(result);
  });

  app.get("/api/evaluations/:decisionId", async (request) => {
    const { decisionId } = decisionParamsSchema.parse(request.params);
    return service.getDecision(decisionId);
  });

  app.post("/api/grants/:grantId/consume", async (request, reply) => {
    const { grantId } = grantParamsSchema.parse(request.params);
    const body = consumeGrantRequestSchema.parse(request.body);
    const result = service.consumeGrant({
      ...body,
      grantId,
      buyer: body.buyer as Address,
      offerHash: body.offerHash as Bytes32,
      identityEpoch: body.identityEpoch as Bytes32,
      policyHash: body.policyHash as Bytes32,
    } satisfies ConsumeGrantRequest);
    return reply.status(201).send(result);
  });

  app.post("/api/payments/:paymentId/events", async (request) => {
    const { paymentId } = paymentParamsSchema.parse(request.params);
    const body = clientPaymentEventRequestSchema.parse(request.body);
    return service.recordPaymentEvent(
      paymentId,
      body as ClientPaymentEventRequest,
    );
  });

  app.get("/api/payments/:paymentId", async (request) => {
    const { paymentId } = paymentParamsSchema.parse(request.params);
    return service.getPayment(paymentId);
  });

  return app;
}
