import type { FetchPort } from "@repugate/client";
import { canonicalizeHttpUrl } from "@repugate/core";

import type { ServiceCatalogItem } from "../api/dto";

export class HttpProviderFetch implements FetchPort {
  requestCount = 0;

  constructor(private readonly service: ServiceCatalogItem) {}

  async fetch(input: string, init: RequestInit): Promise<Response> {
    this.requestCount += 1;
    if (
      canonicalizeHttpUrl(input) !==
      canonicalizeHttpUrl(this.service.offer.resourceUrl)
    ) {
      throw new Error("Provider transport received an unexpected resource URL");
    }

    return fetch(
      `/provider/services/${encodeURIComponent(this.service.id)}/inference`,
      init,
    );
  }
}

export async function checkProviderHealth(): Promise<boolean> {
  try {
    const response = await fetch("/provider/health", {
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}
