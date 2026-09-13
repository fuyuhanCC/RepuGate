import type {
  IdempotencyKeyGenerator,
  SignedEvmAuthorization,
  WalletPort,
} from "@repugate/client";
import type { Address, AuthorizedPaymentIntent } from "@repugate/core";

const DEMO_BUYER =
  "0x08a4c0449ba864B1f463c2ab663014C3a07bE375" as Address;
const DEMO_SIGNATURE = `0x${"42".repeat(65)}` as const;
const DEMO_NONCE = `0x${"24".repeat(32)}` as const;

export class DemoWallet implements WalletPort {
  readonly address = DEMO_BUYER;
  readonly chainId = 84_532;
  signCount = 0;

  async getAddress(): Promise<Address> {
    return this.address;
  }

  async getChainId(): Promise<number> {
    return this.chainId;
  }

  async signX402Authorization(
    intent: AuthorizedPaymentIntent,
  ): Promise<SignedEvmAuthorization> {
    this.signCount += 1;

    return {
      signature: DEMO_SIGNATURE,
      authorization: {
        from: this.address,
        to: intent.offer.payTo,
        value: intent.offer.amount.toString(),
        validAfter: "1700000000",
        validBefore: "1700000060",
        nonce: DEMO_NONCE,
      },
    };
  }
}

export class BrowserIdempotencyKeys implements IdempotencyKeyGenerator {
  next(scope: "consume" | "evaluate" | "payment-event"): string {
    return `${scope}-${crypto.randomUUID()}`;
  }
}

export const DEMO_BUYER_ADDRESS = DEMO_BUYER;
