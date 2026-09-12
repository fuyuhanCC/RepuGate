import { describe, expect, it } from "vitest";

import type { IdentitySnapshotInput } from "../schemas/identity";
import { deriveIdentityEpoch } from "./epoch";

const baseIdentity: IdentitySnapshotInput = {
  agent: {
    chainId: 84532,
    registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    agentId: "12",
  },
  owner: "0x1111111111111111111111111111111111111111",
  agentWallet: "0x209693bc6afc0c5328ba36faf03c514ef312287c",
  registeredEndpoint:
    "HTTPS://Provider.Example:443/services/../services/honest#metadata",
  agentUriHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  observedAtBlock: "100",
};

describe("deriveIdentityEpoch", () => {
  it("normalizes the identity snapshot", () => {
    const snapshot = deriveIdentityEpoch(baseIdentity);

    expect(snapshot.registeredEndpoint).toBe(
      "https://provider.example/services/honest",
    );
    expect(snapshot.agentWallet).toBe(
      "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    );
    expect(snapshot.agent.agentId).toBe(12n);
    expect(snapshot.observedAtBlock).toBe(100n);
  });

  it("does not change when only the observation block changes", () => {
    const first = deriveIdentityEpoch(baseIdentity);
    const later = deriveIdentityEpoch({
      ...baseIdentity,
      observedAtBlock: "200",
    });

    expect(later.identityEpoch).toBe(first.identityEpoch);
  });

  it.each([
    ["owner", { owner: "0x2222222222222222222222222222222222222222" }],
    [
      "agent wallet",
      { agentWallet: "0x3333333333333333333333333333333333333333" },
    ],
    [
      "endpoint",
      { registeredEndpoint: "https://provider.example/services/replacement" },
    ],
    [
      "registration metadata",
      {
        agentUriHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ],
    ["agent ID", { agent: { ...baseIdentity.agent, agentId: "13" } }],
  ])("changes when %s changes", (_label, override) => {
    const original = deriveIdentityEpoch(baseIdentity);
    const changed = deriveIdentityEpoch({ ...baseIdentity, ...override });

    expect(changed.identityEpoch).not.toBe(original.identityEpoch);
  });

  it("rejects a non-HTTP registered endpoint", () => {
    expect(() =>
      deriveIdentityEpoch({
        ...baseIdentity,
        registeredEndpoint: "ipfs://bafy-invalid-for-service-endpoint",
      }),
    ).toThrow();
  });

  it("matches the frozen endpoint and identity-epoch vectors", () => {
    const snapshot = deriveIdentityEpoch(baseIdentity);

    expect(snapshot.endpointHash).toBe(
      "0x14aec9fde2fdb6429ab5dd26c2d2b153f7ac773f468da9f761fa657f4e9eadc3",
    );
    expect(snapshot.identityEpoch).toBe(
      "0xfc70d3db9958b1759cf0da3b6ec707a71917b96121665bb5ce0fc70afe427699",
    );
  });
});
