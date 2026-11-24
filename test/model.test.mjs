import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initialState,
  validateState,
  standings,
  currentQual,
  livePoints,
  elapsedSeconds,
} from "../public/model.js";
import { createApp } from "../server.mjs";

test("live points change rankings and qualification without changing banked totals", () => {
  const state = initialState();
  state.teams[3].eliminations = 10;
  state.teams[3].placement = 1;
  assert.equal(livePoints(state.teams[3], state), 85);
  assert.equal(standings(state)[0].id, "fable");
  assert.equal(currentQual(state), 226);
  assert.equal(state.teams[3].points, 196);
  state.qualifyingPlaces = 10;
  assert.equal(currentQual(state), null);
});
test("ties share rank and do not silently claim an official tiebreaker", () => {
  const state = initialState();
  state.teams.forEach((t) => {
    t.points = 50;
  });
  assert.deepEqual(
    standings(state).map((t) => t.rank),
    [1, 1, 1, 1, 1],
  );
  state.teams[4].points = 40;
  assert.equal(standings(state).at(-1).rank, 5);
});
test("schema rejects script URLs, negative stats, duplicate IDs and invalid featured teams", () => {
  for (const mutate of [
    (s) => (s.teams[0].logo = "javascript:alert(1)"),
    (s) => (s.teams[0].points = -1),
    (s) => (s.teams[1].id = s.teams[0].id),
    (s) => (s.featuredId = "missing"),
  ]) {
    const state = initialState();
    mutate(state);
    assert.throws(() => validateState(state));
  }
});
test("timer stays accurate across refreshes", () => {
  assert.equal(elapsedSeconds({ elapsed: 20, startedAt: 1000 }, 6500), 25);
  assert.equal(elapsedSeconds({ elapsed: 20, startedAt: null }, 6500), 20);
});
test("manual tournament places and qualification line work with a partial field", () => {
  const state = initialState();
  state.teams[0].placeOverride = 42;
  assert.equal(standings(state).find((t) => t.id === "north").rank, 42);
  state.qualifyingPlaces = 25;
  assert.equal(currentQual(state), null);
  state.currentQualOverride = 287;
  assert.equal(currentQual(state), 287);
  assert.equal(validateState(state).teams[0].placeOverride, 42);
});
test("HTTP persistence, conflict handling, SSE and origin protection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dropcast-test-"));
  const dataFile = path.join(dir, "show.json");
  const server = await createApp({ dataFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  try {
    const stream = await fetch(`${base}/api/events`, {
      signal: controller.signal,
    });
    const reader = stream.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /Friday Night Finals/,
    );
    const state = await (await fetch(`${base}/api/state`)).json();
    state.event = "Test Finals";
    const put = (body, extra = {}) =>
      fetch(`${base}/api/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...extra },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await put(state, { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal((await put(state)).status, 200);
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /Test Finals/,
    );
    assert.equal((await put(state)).status, 409);
    assert.equal(JSON.parse(await readFile(dataFile, "utf8")).revision, 1);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/overlay`)).status, 200);
    assert.equal((await fetch(`${base}/../server.mjs`)).status, 404);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const restored = await createApp({ dataFile });
  await new Promise((resolve) => restored.listen(0, "127.0.0.1", resolve));
  try {
    const saved = await (
      await fetch(`http://127.0.0.1:${restored.address().port}/api/state`)
    ).json();
    assert.equal(saved.event, "Test Finals");
    assert.equal(saved.revision, 1);
  } finally {
    restored.closeAllConnections();
    await new Promise((resolve) => restored.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
