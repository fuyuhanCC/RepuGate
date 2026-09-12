export type HttpUrlCanonicalizationErrorCode =
  "URL_CREDENTIALS_NOT_ALLOWED";

export class HttpUrlCanonicalizationError extends Error {
  constructor(
    public readonly code: HttpUrlCanonicalizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpUrlCanonicalizationError";
  }
}

export function canonicalizeHttpUrl(value: string): string {
  const url = new URL(value);

  if (url.username !== "" || url.password !== "") {
    throw new HttpUrlCanonicalizationError(
      "URL_CREDENTIALS_NOT_ALLOWED",
      "HTTP URLs must not contain credentials",
    );
  }

  url.hash = "";
  return url.toString();
}
