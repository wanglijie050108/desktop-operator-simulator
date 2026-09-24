import { AdapterError } from "./adapter-error.js";

export interface ProductCandidate {
  attributes: Record<string, string>;
  collectedAt: string;
  price: number;
  rating: number | null;
  salesText: string | null;
  shopName: string | null;
  title: string;
  url: string;
}

export interface ProductSearchAdapterRequest {
  maxPrice: number;
  preferences: readonly string[];
  query: string;
  signal: AbortSignal;
  taskId: string;
}

export interface ProductExtractionResult {
  adapterVersion: string;
  candidates: readonly unknown[];
  source: string;
}

export interface ProductSearchAdapter {
  extract(request: ProductSearchAdapterRequest): Promise<ProductExtractionResult>;
  open(request: ProductSearchAdapterRequest): Promise<void>;
  search(request: ProductSearchAdapterRequest): Promise<void>;
}

export class UnavailableProductSearchAdapter implements ProductSearchAdapter {
  public open(): Promise<void> {
    return Promise.reject(
      new AdapterError(
        "ADAPTER_NOT_CONFIGURED",
        "A real shopping site adapter has not been configured",
      ),
    );
  }

  public search(): Promise<void> {
    return Promise.reject(
      new AdapterError(
        "ADAPTER_NOT_CONFIGURED",
        "A real shopping site adapter has not been configured",
      ),
    );
  }

  public extract(): Promise<ProductExtractionResult> {
    return Promise.reject(
      new AdapterError(
        "ADAPTER_NOT_CONFIGURED",
        "A real shopping site adapter has not been configured",
      ),
    );
  }
}
