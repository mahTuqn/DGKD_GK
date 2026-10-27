import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const apiBase = (__ENV.API_BASE || "http://127.0.0.1:4001/api").replace(/\/$/, "");
const vus = Number(__ENV.VUS || 50);
const duration = __ENV.DURATION || "5m";
const showtimeDate = __ENV.SHOWTIME_DATE;
const runId = __ENV.RUN_ID;

const unexpectedErrorRate = new Rate("unexpected_error_rate");
const unexpectedErrors = new Counter("unexpected_errors");
const expectedSeatConflicts = new Counter("expected_seat_conflicts");
const showtimesLatency = new Trend("showtimes_latency_ms", true);
const seatMapLatency = new Trend("seat_map_latency_ms", true);
const holdLatency = new Trend("hold_latency_ms", true);
const holdSuccessRate = new Rate("hold_success_rate");
const holdAttempts = new Counter("hold_attempts");
const holdSuccesses = new Counter("hold_successes");

if (!Number.isInteger(vus) || vus < 1) {
  throw new Error("VUS must be a positive integer");
}
if (!showtimeDate || !/^\d{4}-\d{2}-\d{2}$/.test(showtimeDate)) {
  throw new Error("Set SHOWTIME_DATE to the seeded business date in YYYY-MM-DD format");
}
if (!runId || !/^[a-zA-Z0-9-]{1,48}$/.test(runId)) {
  throw new Error("Set RUN_ID to a unique alphanumeric/hyphen fixture suffix");
}

export const options = {
  scenarios: {
    cinema_booking_load: {
      executor: "constant-vus",
      vus,
      duration,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    showtimes_latency_ms: ["p(95)<500"],
    hold_latency_ms: ["p(95)<800"],
    unexpected_error_rate: ["rate<0.01"],
    hold_success_rate: ["rate>0.99"],
  },
};

function responseError(response) {
  try {
    const body = response.json();
    return body && typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

function recordExpectedResponse(response, expectedStatus, tags = {}) {
  // A race-induced SEAT_CONFLICT is expected behavior and is deliberately excluded
  // from the unexpected-error denominator, as required by the project plan.
  if (response.status === 409 && responseError(response) === "SEAT_CONFLICT") {
    expectedSeatConflicts.add(1, tags);
    return false;
  }
  const passed = response.status === expectedStatus;
  unexpectedErrorRate.add(!passed, tags);
  if (!passed) unexpectedErrors.add(1, tags);
  check(response, { [`status ${expectedStatus}`]: () => passed }, tags);
  return passed;
}

export function setup() {
  const health = http.get(`${apiBase}/health`, { tags: { phase: "setup" } });
  if (health.status !== 200) fail(`API health failed with HTTP ${health.status}`);

  const showtimesResponse = http.get(`${apiBase}/showtimes?date=${showtimeDate}`, { tags: { phase: "setup" } });
  if (showtimesResponse.status !== 200) fail(`Could not load seeded showtimes for ${showtimeDate}: HTTP ${showtimesResponse.status}`);
  const showtimes = showtimesResponse.json();
  if (!Array.isArray(showtimes) || showtimes.length === 0) fail(`No active showtimes found for ${showtimeDate}`);

  const availableSlots = [];
  for (const showtime of showtimes) {
    const seatResponse = http.get(`${apiBase}/showtimes/${showtime.id}/seats`, { tags: { phase: "setup" } });
    if (seatResponse.status !== 200) fail(`Could not load seats for showtime ${showtime.id}: HTTP ${seatResponse.status}`);
    const seatData = seatResponse.json();
    for (const seat of seatData.seats || []) {
      if (seat.status === "AVAILABLE") availableSlots.push({ showtimeId: showtime.id, seatId: seat.id });
    }
  }
  if (availableSlots.length < vus) {
    fail(`Need ${vus} unique available seat slots, found ${availableSlots.length}`);
  }

  // Dedicated per-run accounts keep the active-hold-per-customer invariant valid.
  // The whole performance database is disposable and is dropped after the run.
  const users = [];
  for (let index = 0; index < vus; index += 1) {
    const email = `k6perf-${runId}-${index + 1}@example.test`;
    const registration = http.post(
      `${apiBase}/auth/register`,
      JSON.stringify({ name: `k6 Perf ${index + 1}`, email, password: "K6PerformanceOnly123!" }),
      { headers: { "Content-Type": "application/json" }, tags: { phase: "setup" } },
    );
    if (registration.status !== 201) fail(`Could not create isolated k6 user ${index + 1}: HTTP ${registration.status}`);
    users.push({ token: registration.json("token"), ...availableSlots[index] });
  }
  return { users, showtimeDate };
}

// One valid hold is issued per VU against a unique account/seat. Remaining
// iterations sustain 50-VU catalog and seat-map reads while the claims stay held.
export default function (data) {
  const user = data.users[__VU - 1];
  const showtimesResponse = http.get(`${apiBase}/showtimes?date=${data.showtimeDate}`, { tags: { operation: "catalog" } });
  showtimesLatency.add(showtimesResponse.timings.duration);
  recordExpectedResponse(showtimesResponse, 200, { operation: "catalog" });

  const seatMapResponse = http.get(`${apiBase}/showtimes/${user.showtimeId}/seats`, { tags: { operation: "seat_map" } });
  seatMapLatency.add(seatMapResponse.timings.duration);
  recordExpectedResponse(seatMapResponse, 200, { operation: "seat_map" });

  if (!user.holdAttempted) {
    user.holdAttempted = true;
    holdAttempts.add(1);
    const holdResponse = http.post(
      `${apiBase}/holds`,
      JSON.stringify({ showtimeId: user.showtimeId, seatIds: [user.seatId] }),
      { headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" }, tags: { operation: "hold" } },
    );
    const passed = recordExpectedResponse(holdResponse, 201, { operation: "hold" });
    if (holdResponse.status !== 409 || responseError(holdResponse) !== "SEAT_CONFLICT") {
      holdLatency.add(holdResponse.timings.duration);
      holdSuccessRate.add(passed);
    }
    if (passed) holdSuccesses.add(1);
  }

  sleep(1);
}
