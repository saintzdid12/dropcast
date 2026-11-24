import snapshot from "./clutch-snapshot.js";
export const placementTable = [
  65, 56, 52, 48, 44, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14,
  12, 10, 8, 6, 4, 2,
];
export function initialState() {
  return {
    revision: 0,
    event: snapshot.event,
    stage: snapshot.stage,
    match: 3,
    totalMatches: snapshot.totalMatches,
    qualifyingPlaces: 15,
    currentQualOverride: null,
    estimatedQual: null,
    eliminationPoints: 0,
    placementPoints: [100],
    featuredId: snapshot.teams.find((t) => t.name.includes("Peterbot")).id,
    visible: true,
    timer: { elapsed: 0, startedAt: null },
    source: { ...snapshot.source, edited: false },
    teams: structuredClone(snapshot.teams),
  };
}
export function livePoints(team, state) {
  return (
    team.eliminations * state.eliminationPoints +
    (state.placementPoints[team.placement - 1] || 0)
  );
}
export function bankMatch(state) {
  for (const team of state.teams) {
    team.points += livePoints(team, state);
    team.wins = (team.wins || 0) + (team.placement === 1 ? 1 : 0);
    team.totalEliminations = (team.totalEliminations || 0) + team.eliminations;
    team.matches++;
    team.eliminations = 0;
    team.placement = 0;
  }
  if (state.source) state.source.edited = true;
  state.match = Math.min(state.match + 1, state.totalMatches);
  state.timer = { elapsed: 0, startedAt: null };
  return state;
}
export function standings(state) {
  // Equal totals share a rank. Alphabetical order only stabilizes the display; it is not an official tiebreaker.
  const rows = [...state.teams].sort(
    (a, b) =>
      b.points + livePoints(b, state) - (a.points + livePoints(a, state)) ||
      a.name.localeCompare(b.name),
  );
  let rank = 1;
  return rows
    .map((team, i) => {
      if (
        i === 0 ||
        team.points + livePoints(team, state) !==
          rows[i - 1].points + livePoints(rows[i - 1], state)
      )
        rank = i + 1;
      return {
        ...team,
        total: team.points + livePoints(team, state),
        rank: team.placeOverride || rank,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
export function currentQual(state) {
  if (state.currentQualOverride != null) return state.currentQualOverride;
  if (state.teams.some((team) => team.placeOverride > 0))
    return (
      standings(state).find((team) => team.rank === state.qualifyingPlaces)
        ?.total ?? null
    );
  return standings(state)[state.qualifyingPlaces - 1]?.total ?? null;
}
export function elapsedSeconds(timer, now = Date.now()) {
  return Math.floor(
    timer.elapsed +
      (timer.startedAt === null
        ? 0
        : Math.max(0, now - timer.startedAt) / 1000),
  );
}
export function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function text(value, max, label) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label} must be text up to ${max} characters.`);
  return value.trim();
}
export function validateState(input) {
  if (!input || typeof input !== "object")
    throw new Error("Expected a show object.");
  const result = {
    revision: integer(input.revision, 0, Number.MAX_SAFE_INTEGER, "Revision"),
    event: text(input.event, 100, "Event"),
    stage: text(input.stage, 100, "Stage"),
    match: integer(input.match, 1, 100, "Match"),
    totalMatches: integer(input.totalMatches, 1, 100, "Total matches"),
    qualifyingPlaces: integer(
      input.qualifyingPlaces,
      1,
      100000,
      "Qualifying places",
    ),
    currentQualOverride:
      input.currentQualOverride == null
        ? null
        : integer(
            input.currentQualOverride,
            0,
            1000000,
            "Current qualification points",
          ),
    estimatedQual:
      input.estimatedQual == null
        ? null
        : integer(
            input.estimatedQual,
            0,
            1000000,
            "Estimated qualification points",
          ),
    eliminationPoints: integer(
      input.eliminationPoints,
      0,
      100,
      "Points per elimination",
    ),
    source: input.source
      ? {
          label: text(input.source.label, 80, "Source label"),
          url: text(input.source.url, 2048, "Source URL"),
          capturedAt: text(input.source.capturedAt, 60, "Source timestamp"),
          edited: input.source.edited === true,
        }
      : null,
    visible: input.visible === true,
    featuredId: text(input.featuredId, 80, "Featured team"),
    timer: {
      elapsed: integer(input.timer?.elapsed, 0, 604800, "Timer"),
      startedAt:
        input.timer?.startedAt === null
          ? null
          : integer(
              input.timer?.startedAt,
              0,
              Number.MAX_SAFE_INTEGER,
              "Timer start",
            ),
    },
  };
  if (result.source && !/^https:\/\/clutchfn\.com\//.test(result.source.url))
    throw new Error("Source URL must be a Clutch HTTPS URL.");
  if (result.match > result.totalMatches)
    throw new Error("Match cannot exceed total matches.");
  if (
    !Array.isArray(input.placementPoints) ||
    input.placementPoints.length > 100
  )
    throw new Error("Provide up to 100 placement scores.");
  result.placementPoints = input.placementPoints.map((x) =>
    integer(x, 0, 10000, "Placement points"),
  );
  if (
    !Array.isArray(input.teams) ||
    input.teams.length < 1 ||
    input.teams.length > 500
  )
    throw new Error("Provide between 1 and 500 teams.");
  result.teams = input.teams.map((team) => {
    if (!team || typeof team !== "object")
      throw new Error("Expected a team object.");
    const logo = text(team.logo, 2048, "Logo URL");
    if (logo && !/^https?:\/\//i.test(logo))
      throw new Error("Logo must be an HTTP or HTTPS URL.");
    if (!/^#[0-9a-f]{6}$/i.test(team.color))
      throw new Error("Choose a valid team color.");
    const id = text(team.id, 80, "Team ID");
    const name = text(team.name, 40, "Team name");
    if (!id || !name) throw new Error("Team ID and name are required.");
    return {
      id,
      name,
      roster: text(team.roster, 100, "Roster"),
      color: team.color,
      logo,
      points: integer(team.points, 0, 1000000, "Banked points"),
      placeOverride: integer(
        team.placeOverride ?? 0,
        0,
        100000,
        "Place override",
      ),
      wins: integer(team.wins ?? 0, 0, 100, "Wins"),
      totalEliminations: integer(
        team.totalEliminations ?? 0,
        0,
        10000,
        "Total eliminations",
      ),
      matches: integer(team.matches, 0, 100, "Matches"),
      eliminations: integer(team.eliminations, 0, 200, "Eliminations"),
      placement: integer(team.placement, 0, 100, "Placement"),
    };
  });
  if (new Set(result.teams.map((x) => x.id)).size !== result.teams.length)
    throw new Error("Team IDs must be unique.");
  if (!result.teams.some((x) => x.id === result.featuredId))
    throw new Error("Featured team must exist.");
  return result;
}
