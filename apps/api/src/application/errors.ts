export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export function notFound(resource: string): ApplicationError {
  return new ApplicationError(
    `${resource.toUpperCase()}_NOT_FOUND`,
    `${resource} was not found`,
    404,
  );
}
