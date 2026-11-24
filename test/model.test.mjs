import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initialState as productionState,
  bankMatch,
  validateState,
  standings,
  currentQual,
  livePoints,
  elapsedSeconds,
} from "../public/model.js";
import { createApp } from "../server.mjs";

function initialState() {
  const s = productionState();
  Object.assign(s, {
    event: "Friday Night Finals",
    stage: "Europe / Duos",
    match: 5,
    totalMatches: 6,
    qualifyingPlaces: 3,
    currentQualOverride: null,
    estimatedQual: 300,
    source: null,
    eliminationPoints: 2,
    placementPoints: [65, 56, 52, 48, 44, 40],
    featuredId: "north",
  });
  s.teams = ["north", "orbit", "tempo", "fable", "atlas"].map((id, i) => ({
    id,
    name: id,
    roster: "Test players",
    color: "#4158c9",
    logo: "",
    points: [240, 226, 210, 196, 182][i],
    matches: 4,
    wins: 0,
    totalEliminations: 0,
    eliminations: 0,
    placement: 0,
  }));
  return s;
}

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
test("banking transfers live points, wins and eliminations without counting them twice", () => {
  const state = initialState();
  state.teams[0].eliminations = 4;
  state.teams[0].placement = 1;
  state.teams[0].wins = 2;
  state.teams[0].totalEliminations = 20;
  bankMatch(state);
  const team = state.teams[0];
  assert.equal(team.points, 313);
  assert.equal(team.wins, 3);
  assert.equal(team.totalEliminations, 24);
  assert.equal(team.matches, 5);
  assert.equal(livePoints(team, state), 0);
  assert.equal(team.placement, 0);
});
test("Clutch snapshot preserves reported ranks and cumulative stats", () => {
  const state = validateState(productionState());
  const team = state.teams.find((t) => t.name.includes("Peterbot"));
  assert.deepEqual(
    [
      team.matches,
      team.wins,
      team.totalEliminations,
      team.points,
      team.placeOverride,
    ],
    [3, 1, 14, 100, 13],
  );
  assert.equal(state.estimatedQual, null);
  assert.match(state.source.url, /^https:\/\/clutchfn.com\//);
  // Show exports from v1.0 remain readable without the new cumulative fields.
  const old = initialState();
  delete old.teams[0].wins;
  delete old.teams[0].totalEliminations;
  assert.equal(validateState(old).teams[0].wins, 0);
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
      /Squads Victory Cup/,
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
