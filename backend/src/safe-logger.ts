export function logSafeError(event: string, correlationId: string, error: unknown) {
  // Error messages and stacks can contain secrets, request bodies, or provider
  // payloads. Keep application logs to controlled metadata only.
  console.error(JSON.stringify({
    level: "error",
    event,
    correlationId,
    errorKind: error instanceof Error ? "Error" : "NonError"
  }));
}
