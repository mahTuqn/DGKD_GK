export function classifyK6Response(status, errorCode, expectedStatus, { allowExpectedSeatConflict = false } = {}) {
  const expectedConflict = allowExpectedSeatConflict && status === 409 && errorCode === "SEAT_CONFLICT";
  const passed = status === expectedStatus;
  return {
    passed,
    expectedConflict,
    unexpectedError: !passed && !expectedConflict,
  };
}

export function recordHoldMetrics(metrics, outcome, durationMs, tags = {}) {
  metrics.attempts.add(1, tags);
  // Every attempted hold contributes to this success rate, including an
  // expected seat conflict. Conflicts are expected behavior, but they are not
  // successful holds and must not disappear from the >99% success threshold.
  metrics.successRate.add(outcome.passed, tags);
  if (outcome.expectedConflict) {
    metrics.expectedConflicts.add(1, tags);
  } else {
    metrics.latency.add(durationMs, tags);
  }
  if (outcome.passed) metrics.successes.add(1, tags);
}
