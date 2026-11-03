export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "VALIDATION_ERROR",
    public requestId?: string,
  ) {
    super(message);
  }
}
export function safeError(error: unknown): {
  error: string;
  code: string;
  requestId?: string;
} {
  if (error instanceof AppError)
    return {
      error: error.message,
      code: error.code,
      requestId: error.requestId,
    };
  return {
    error:
      "The operation could not be completed. Check the server and retry safely.",
    code: "OPERATION_FAILED",
  };
}
