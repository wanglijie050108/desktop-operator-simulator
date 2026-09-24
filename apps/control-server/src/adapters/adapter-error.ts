export type AdapterErrorCode =
  | "ADAPTER_NOT_CONFIGURED"
  | "AI_PAGE_UNAVAILABLE"
  | "SHOPPING_SITE_UNAVAILABLE"
  | "LOGIN_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "SITE_LAYOUT_CHANGED"
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
