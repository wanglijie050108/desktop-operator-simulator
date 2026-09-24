export type AdapterErrorCode =
  | "ADAPTER_NOT_CONFIGURED"
  | "ADAPTER_TIMEOUT"
  | "AI_PAGE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "SHOPPING_SITE_UNAVAILABLE"
  | "LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "SERVICE_UNAVAILABLE"
  | "SITE_LAYOUT_CHANGED"
  | "TEMPORARY_UNAVAILABLE"
  | "INVALID_PRODUCT_DATA"
  | "NO_PRODUCTS_IN_BUDGET";

export class AdapterError extends Error {
  public constructor(
    public readonly code: AdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
