/** Maps Postgres SQLSTATE-style codes used by legacy RPC handlers to HTTP responses. */
export class SqlStateError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SqlStateError";
  }
}
