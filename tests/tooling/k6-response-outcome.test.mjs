import assert from "node:assert/strict";
import test from "node:test";
import { classifyK6Response, recordHoldMetrics } from "../non-functional/k6/response-outcome.js";

function metric() {
  return {
    samples: [],
    add(value, tags) {
      this.samples.push({ value, tags });
    },
  };
}

function holdMetrics() {
  return {
    attempts: metric(),
    successRate: metric(),
    successes: metric(),
    expectedConflicts: metric(),
    latency: metric(),
  };
}

test("an expected hold seat conflict is excluded from unexpected errors but counted as a failed hold", () => {
  const outcome = classifyK6Response(409, "SEAT_CONFLICT", 201, { allowExpectedSeatConflict: true });
  assert.deepEqual(outcome, { passed: false, expectedConflict: true, unexpectedError: false });

  const metrics = holdMetrics();
  recordHoldMetrics(metrics, outcome, 17, { operation: "hold" });
  assert.deepEqual(metrics.attempts.samples.map(({ value }) => value), [1]);
  assert.deepEqual(metrics.successRate.samples.map(({ value }) => value), [false]);
  assert.deepEqual(metrics.successes.samples, []);
  assert.deepEqual(metrics.expectedConflicts.samples.map(({ value }) => value), [1]);
  assert.deepEqual(metrics.latency.samples, []);
});

test("a seat conflict from catalog or seat-map requests is an unexpected endpoint error", () => {
  assert.deepEqual(classifyK6Response(409, "SEAT_CONFLICT", 200), {
    passed: false,
    expectedConflict: false,
    unexpectedError: true,
  });
});

test("successful holds contribute a successful rate sample, latency, and success count", () => {
  const outcome = classifyK6Response(201, "", 201, { allowExpectedSeatConflict: true });
  const metrics = holdMetrics();
  recordHoldMetrics(metrics, outcome, 42, { operation: "hold" });

  assert.deepEqual(metrics.attempts.samples.map(({ value }) => value), [1]);
  assert.deepEqual(metrics.successRate.samples.map(({ value }) => value), [true]);
  assert.deepEqual(metrics.successes.samples.map(({ value }) => value), [1]);
  assert.deepEqual(metrics.expectedConflicts.samples, []);
  assert.deepEqual(metrics.latency.samples.map(({ value }) => value), [42]);
});
