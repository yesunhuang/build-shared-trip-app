// Structured domain errors shared by the HTTP API and the MCP tools.

export class DomainError extends Error {
  constructor(code, status, message, extra = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function validationError(details, message = "The submitted data is invalid.") {
  const list = Array.isArray(details) ? details.slice(0, 50) : [details];
  return new DomainError("validation_failed", 422, message, { details: list });
}

export function notFound(code = "trip_not_found", message = "Trip not found.") {
  return new DomainError(code, 404, message);
}

// The trip was permanently deleted by the owner (schema v6 tombstone). Carries no trip content.
export function tripDeleted() {
  return new DomainError("trip_deleted", 410, "This trip was permanently deleted.");
}

export function conflict(code, message, extra = {}) {
  return new DomainError(code, 409, message, extra);
}

export function errorBody(error) {
  if (error instanceof DomainError) return error.toJSON();
  return { error: { code: "internal_error", message: "Unexpected server error." } };
}

export function errorStatus(error) {
  return error instanceof DomainError ? error.status : 500;
}
