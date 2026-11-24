import {
  standings,
  currentQual,
  livePoints,
  elapsedSeconds,
  formatTime,
  validateState,
} from "./model.js";

const $ = (id) => document.getElementById(id);
const overlay = document.body.classList.contains("overlay-page");
const params = new URLSearchParams(location.search);
let view = params.get("view") === "featured" ? "featured" : "leaderboard";
let state,
  saving = false,
  queue = Promise.resolve();
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ],
  );
const number = (value) => Number(value);
const mark = (team) =>
  `<span class="team-mark" style="--team-color:${team.color}">${team.logo ? `<img src="${escape(team.logo)}" alt="">` : escape(team.name.slice(0, 1))}</span>`;
function board() {
  if (!state) return "";
  const rows = standings(state);
  const team = rows.find((x) => x.id === state.featuredId) || rows[0];
  const cutoff = currentQual(state);
  const header = `<div class="board-head"><div><div class="board-title">${escape(state.event)}</div><div class="board-stage">${escape(state.stage)}</div></div><div class="board-match">Match ${state.match} / ${state.totalMatches}<span data-clock>${formatTime(elapsedSeconds(state.timer))}</span></div></div>`;
  const qualification = `<div class="qual-bar"><div>Current qual <strong>${cutoff ?? "—"}</strong></div><div>Estimated qual <strong>${state.estimatedQual}</strong></div></div>`;
  const featured = `<div class="featured-main" style="--team-color:${team.color}">${mark(team)}<div><div class="featured-name">${escape(team.name)}</div><div class="featured-roster">${escape(team.roster)}</div></div></div><div class="featured-stats"><div><span>Place</span><strong>#${team.rank}</strong></div><div><span>Points</span><strong>${team.total}</strong></div><div><span>Matches</span><strong>${team.matches}</strong></div><div><span>Live elims</span><strong>${team.eliminations}</strong></div></div>`;
  const leaderboard = `<div class="board-columns"><span>#</span><span>Team</span><span>Played</span><span>Points</span></div>${rows
    .slice(0, Math.min(12, Math.max(1, Number(params.get("rows")) || 5)))
    .map(
      (team) =>
        `<div class="board-row ${team.id === state.featuredId ? "is-featured" : ""}"><span>${team.rank}</span><div class="team-cell">${mark(team)}<span class="team-text">${escape(team.name)}</span></div><span>${team.matches}</span><span class="points">${team.total}</span></div>`,
    )
    .join("")}`;
  return `<div class="board ${!state.visible && overlay ? "is-hidden" : ""}">${header}${qualification}${view === "featured" ? featured : leaderboard}<div class="board-foot"><span>Top ${state.qualifyingPlaces} qualify${view === "featured" && cutoff !== null ? ` / ${team.total >= cutoff ? "+" : ""}${team.total - cutoff} from line` : ""}</span><span>Provisional standings</span></div></div>`;
}
function message(text, error = false) {
  if ($("message")) {
    $("message").textContent = text;
    $("message").dataset.error = String(error);
  }
}
function renderGraphic() {
  (overlay ? $("overlay-root") : $("preview-board")).innerHTML = board();
  // Broken remote logos fall back to a team initial instead of a broken-image icon.
  document.querySelectorAll(".team-mark img").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        img.parentElement.textContent = img.closest(".featured-main")
          ? state.teams.find((x) => x.id === state.featuredId)?.name[0] || "?"
          : "?";
      },
      { once: true },
    ),
  );
}
function input(field, value, id, min = 0, max = 1000000) {
  return `<input type="number" min="${min}" max="${max}" value="${value}" data-team="${escape(id)}" data-field="${field}" aria-label="${field} for ${escape(state.teams.find((x) => x.id === id).name)}">`;
}
function render() {
  renderGraphic();
  if (overlay) return;
  $("event-title").textContent = state.event;
  for (const key of [
    "event",
    "stage",
    "match",
    "totalMatches",
    "qualifyingPlaces",
    "estimatedQual",
    "eliminationPoints",
  ])
    $(key).value = state[key];
  $("placementPoints").value = state.placementPoints.join(", ");
  $("currentQualOverride").value = state.currentQualOverride ?? "";
  $("visibility").textContent = state.visible ? "Hide overlay" : "Show overlay";
  $("toggle-clock").textContent =
    state.timer.startedAt === null ? "Start clock" : "Pause clock";
  $("qual-explainer").textContent =
    currentQual(state) === null
      ? "Enter the tournament cutoff above, or add the qualifying team to calculate it. Auto mode needs the full field for an accurate line."
      : `Current line: ${currentQual(state)} points at place ${state.qualifyingPlaces}. ${state.currentQualOverride != null ? "Manual cutoff." : "Calculated from entered standings, including live points."} Estimate is entered manually.`;
  $("teams").innerHTML = standings(state)
    .map(
      (team) =>
        `<tr><td class="rank">#${team.rank}</td><td><div class="team-name">${escape(team.name)}</div><small>${escape(team.roster)}</small></td><td>${input("points", team.points, team.id)}</td><td>${input("matches", team.matches, team.id, 0, 100)}</td><td>${input("eliminations", team.eliminations, team.id, 0, 200)}</td><td>${input("placement", team.placement, team.id, 0, 100)}</td><td class="total">${team.total}</td><td><button data-feature="${escape(team.id)}" aria-pressed="${state.featuredId === team.id}">${state.featuredId === team.id ? "Featured" : "Feature"}</button></td></tr>`,
    )
    .join("");
  $("identity-editor").innerHTML = state.teams
    .map(
      (team) =>
        `<div class="identity-row"><label>Team name<input data-team="${escape(team.id)}" data-field="name" value="${escape(team.name)}" maxlength="40"></label><label>Players<input data-team="${escape(team.id)}" data-field="roster" value="${escape(team.roster)}" maxlength="100"></label><label>Color<input type="color" data-team="${escape(team.id)}" data-field="color" value="${team.color}"></label><label class="logo-field">Logo URL (optional)<input data-team="${escape(team.id)}" data-field="logo" type="url" value="${escape(team.logo)}" placeholder="https://…"></label><label>Place override (0 = auto)<input data-team="${escape(team.id)}" data-field="placeOverride" type="number" min="0" max="100000" value="${team.placeOverride || 0}"></label><button data-remove="${escape(team.id)}" ${state.teams.length === 1 ? "disabled" : ""}>Remove</button></div>`,
    )
    .join("");
  updateSource();
  tick();
}
function updateSource() {
  $("view-leaderboard").setAttribute(
    "aria-pressed",
    String(view === "leaderboard"),
  );
  $("view-featured").setAttribute("aria-pressed", String(view === "featured"));
  const url = `${location.origin}/overlay${view === "featured" ? "?view=featured" : ""}`;
  $("source-url").value = url;
  $("open-overlay").href = url;
}
function change(fn, success = "Saved to show.") {
  queue = queue.then(async () => {
    saving = true;
    try {
      const next = structuredClone(state);
      fn(next);
      validateState(next);
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409)
          state = await (await fetch("/api/state")).json();
        throw new Error(result.error);
      }
      state = result;
      render();
      message(success);
    } catch (error) {
      message(error.message, true);
      if (state) render();
    } finally {
      saving = false;
    }
  });
}
function tick() {
  if (!state) return;
  document
    .querySelectorAll("[data-clock],#clock")
    .forEach(
      (el) => (el.textContent = formatTime(elapsedSeconds(state.timer))),
    );
}
function setupDesk() {
  $("currentQualOverride").addEventListener("change", (event) => {
    const value = event.target.value === "" ? null : Number(event.target.value);
    change((next) => {
      next.currentQualOverride = value;
    });
  });
  for (const key of [
    "event",
    "stage",
    "match",
    "totalMatches",
    "qualifyingPlaces",
    "estimatedQual",
    "eliminationPoints",
  ]) {
    $(key).addEventListener("change", (event) => {
      const value =
        event.target.type === "number"
          ? number(event.target.value)
          : event.target.value;
      change((next) => {
        next[key] = value;
      });
    });
  }
  $("placementPoints").addEventListener("change", (event) => {
    const values = event.target.value.trim()
      ? event.target.value.split(",").map((x) => Number(x.trim()))
      : [];
    change((next) => {
      next.placementPoints = values;
    });
  });
  document.addEventListener("change", (event) => {
    const { team, field } = event.target.dataset;
    if (team && field) {
      const value =
        event.target.type === "number"
          ? number(event.target.value)
          : event.target.value;
      change((next) => {
        next.teams.find((x) => x.id === team)[field] = value;
      });
    }
  });
  document.addEventListener("click", (event) => {
    const feature = event.target.dataset.feature,
      remove = event.target.dataset.remove;
    if (feature)
      change((next) => {
        next.featuredId = feature;
      }, "Featured team updated.");
    if (
      remove &&
      confirm(
        "Remove this team and its results? Export your show first if you need a backup.",
      )
    )
      change((next) => {
        next.teams = next.teams.filter((x) => x.id !== remove);
        if (next.featuredId === remove) next.featuredId = next.teams[0].id;
      });
  });
  $("add-team").onclick = () =>
    change((next) => {
      next.teams.push({
        id: crypto.randomUUID(),
        name: `Team ${next.teams.length + 1}`,
        roster: "",
        color: "#4158c9",
        logo: "",
        points: 0,
        matches: 0,
        eliminations: 0,
        placement: 0,
      });
    }, "Team added. Edit its name under Edit team identity.");
  $("visibility").onclick = () =>
    change((next) => {
      next.visible = !next.visible;
    });
  $("toggle-clock").onclick = () =>
    change((next) => {
      if (next.timer.startedAt === null) next.timer.startedAt = Date.now();
      else
        next.timer = { elapsed: elapsedSeconds(next.timer), startedAt: null };
    });
  $("reset-clock").onclick = () =>
    change((next) => {
      next.timer = { elapsed: 0, startedAt: null };
    });
  $("bank-match").onclick = () => {
    if (
      confirm(
        "Bank this match for every listed team? This adds live points, increments matches, clears live results, and advances the match number when possible. Export a backup first if needed.",
      )
    )
      change((next) => {
        for (const team of next.teams) {
          team.points += livePoints(team, next);
          team.matches++;
          team.eliminations = 0;
          team.placement = 0;
        }
        next.match = Math.min(next.match + 1, next.totalMatches);
        next.timer = { elapsed: 0, startedAt: null };
      }, "Match banked. Live results cleared.");
  };
  $("view-leaderboard").onclick = () => {
    view = "leaderboard";
    renderGraphic();
    updateSource();
  };
  $("view-featured").onclick = () => {
    view = "featured";
    renderGraphic();
    updateSource();
  };
  $("copy-source").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("source-url").value);
      message("OBS source URL copied.");
    } catch {
      $("source-url").select();
      message("Select and copy the URL from the field.");
    }
  };
  $("export").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "dropcast-show.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("import").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 262144) throw new Error("Show file is too large.");
      const imported = validateState(JSON.parse(await file.text()));
      if (confirm("Replace the current show with this file?"))
        change((next) => {
          const revision = next.revision;
          Object.assign(next, imported, { revision });
        }, "Show imported.");
    } catch (error) {
      message(`Cannot import show: ${error.message}`, true);
    }
    event.target.value = "";
  };
  $("reset").onclick = () => {
    if (
      confirm(
        "Clear all team points, matches, eliminations, placements, and place overrides? Team identities and event settings will stay.",
      )
    )
      change((next) => {
        next.match = 1;
        next.timer = { elapsed: 0, startedAt: null };
        next.teams.forEach((team) =>
          Object.assign(team, {
            points: 0,
            matches: 0,
            eliminations: 0,
            placement: 0,
            placeOverride: 0,
          }),
        );
      }, "All results cleared.");
  };
}
if (overlay)
  document.body.dataset.position = ["left", "bottom"].includes(
    params.get("position"),
  )
    ? params.get("position")
    : "right";
else setupDesk();
const events = new EventSource("/api/events");
events.onmessage = (event) => {
  const incoming = JSON.parse(event.data);
  if (!saving && (!state || incoming.revision >= state.revision)) {
    state = incoming;
    render();
  }
  if (overlay) $("overlay-status").hidden = true;
  else {
    $("connection").textContent = "Connected to show";
    $("connection").dataset.state = "online";
  }
};
events.onerror = () => {
  if (overlay) $("overlay-status").hidden = false;
  else {
    $("connection").textContent = "Reconnecting…";
    $("connection").dataset.state = "offline";
    message(
      "Connection lost. Last saved results remain on screen. Check that the Dropcast server is running.",
      true,
    );
  }
};
setInterval(tick, 250);
