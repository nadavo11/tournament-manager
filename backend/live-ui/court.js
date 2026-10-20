// Quick team scoring first; optional two-tap player attribution uses the same event log.
let courtState = null,
  courtMatchId =
    Number(new URLSearchParams(location.search).get("match")) || null;
let courtDetailed = false,
  courtPlayerSide = 1,
  courtSelected = { 1: null, 2: null };
let courtLoading = false,
  courtSending = false,
  courtQueueError = "",
  courtErrorStatus = null;
let courtClockMark = 0,
  courtOffline = false,
  courtLastTournament = null;
let courtQueue = [];
try {
  courtQueue = JSON.parse(
    sessionStorage.getItem("basketball-pending-v1") || "[]",
  );
  if (!Array.isArray(courtQueue)) courtQueue = [];
} catch {}
const courtWords = {
  "Live Court": "לוח חי",
  "Quick score": "ניקוד מהיר",
  "Player stats": "נתוני שחקנים",
  "Free throw": "עונשין",
  Foul: "עבירה",
  Timeout: "פסק זמן",
  "Undo last play": "ביטול פעולה אחרונה",
  "Start clock": "הפעלת שעון",
  Pause: "עצירה",
  "Next period": "תקופה הבאה",
  "Set clock": "כוון שעון",
  "Game setup": "הגדרות משחק",
  "Finish game": "סיום משחק",
  "Reopen game": "פתיחת המשחק מחדש",
  "Play-by-play": "מהלך המשחק",
  "Team / unassigned": "קבוצה / ללא שיוך",
  "Add players": "הוספת שחקנים",
  Possession: "החזקה",
  "Off. rebound": "ריבאונד התקפה",
  "Def. rebound": "ריבאונד הגנה",
  Assist: "אסיסט",
  Steal: "חטיפה",
  Block: "חסימה",
  Turnover: "איבוד",
  "Technical foul": "עבירה טכנית",
  Unsportsmanlike: "בלתי ספורטיבית",
  Violation: "הפרת חוק",
  "Sub in": "כניסה",
  "Sub out": "יציאה",
  "Missed FT": "החטאת עונשין",
  "Missed 1PT": "החטאת 1",
  "Missed 2PT": "החטאת 2",
  "Missed 3PT": "החטאת 3",
  "Select player": "בחירת שחקן",
  Undo: "ביטול",
  Retry: "נסה שוב",
  Discard: "ביטול פעולה שלא נשמרה",
  "Live display": "תצוגה חיה",
  "Court control": "ניהול משחק",
};
const ct = (text) => (lang === "he" ? courtWords[text] || text : text);
const courtLabels = {
  one_made: "1PT made",
  two_made: "2PT made",
  three_made: "3PT made",
  free_throw_made: "Free throw",
  one_missed: "Missed 1PT",
  two_missed: "Missed 2PT",
  three_missed: "Missed 3PT",
  free_throw_missed: "Missed FT",
  offensive_rebound: "Off. rebound",
  defensive_rebound: "Def. rebound",
  assist: "Assist",
  steal: "Steal",
  block: "Block",
  turnover: "Turnover",
  personal_foul: "Foul",
  technical_foul: "Technical foul",
  unsportsmanlike_foul: "Unsportsmanlike",
  timeout: "Timeout",
  violation: "Violation",
  sub_in: "Sub in",
  sub_out: "Sub out",
  adjust_plus: "Score correction +1",
  adjust_minus: "Score correction −1",
  clock_start: "Start clock",
  clock_pause: "Pause",
  next_period: "Next period",
  set_clock: "Set clock",
  profile: "Game setup",
  possession: "Possession",
  finish: "Finish game",
  resume: "Reopen game",
  undo: "Play undone",
};
function courtTime(ms) {
  let seconds = Math.ceil(Math.max(0, ms) / 1000);
  return (
    String(Math.floor(seconds / 60)).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
function courtPeriod(period = courtState?.game.period) {
  if (!courtState) return "";
  let g = courtState.game;
  if (period > g.period_count) return "OT " + (period - g.period_count);
  return g.period_count === 1
    ? lang === "he"
      ? "משחק"
      : "GAME"
    : g.period_count === 2
      ? "H" + period
      : "Q" + period;
}
function courtPlayer(id) {
  return courtState?.roster.find((p) => p.id === id);
}
function courtPlayerName(player) {
  return player
    ? (player.jersey ? "#" + player.jersey + " " : "") + player.name
    : ct("Team / unassigned");
}
function courtReady() {
  return (
    canScore() &&
    courtState?.match.home_team_id &&
    courtState?.match.away_team_id
  );
}
function courtPending() {
  return courtQueue.filter((q) => q.tid === tid && q.mid === courtMatchId)
    .length;
}
function courtSaveQueue() {
  sessionStorage.setItem("basketball-pending-v1", JSON.stringify(courtQueue));
}

function renderCourt() {
  const matches = allMatches();
  if (courtLastTournament !== tid) {
    courtLastTournament = tid;
    courtState = null;
    if (!matches.some((m) => m.id === courtMatchId)) courtMatchId = null;
    courtSelected = { 1: null, 2: null };
  }
  if (!matches.some((m) => m.id === courtMatchId))
    courtMatchId =
      matches.find((m) => m.live_status === "LIVE")?.id || matches[0]?.id;
  const picker = `<div class="court-topbar"><div><span class="kicker">${ct(canScore() ? "Court control" : "Live display")}</span><h2>${ct("Live Court")}</h2></div><label class="court-match-picker"><span>Match</span><select id="court-match" aria-label="Live match">${matches.map((m) => `<option value="${m.id}" ${m.id === courtMatchId ? "selected" : ""}>${esc(team(m, 1))} vs ${esc(team(m, 2))} · #${m.id} · ${tr(m.live_status)}</option>`).join("")}</select></label><button id="court-fullscreen" aria-label="Fullscreen scoreboard">⛶</button></div>`;
  if (!courtState || courtState.match.id !== courtMatchId)
    return (
      picker +
      `<div class="court-loading" role="status">${courtOffline ? "Connection unavailable. Retrying…" : "Loading the shared scoreboard…"}</div>`
    );
  const s = courtState,
    m = s.match,
    g = s.game,
    editable = courtReady() && m.status !== "COMPLETED",
    pending = courtPending();
  const teamPanel = (side) => {
    const name = side === 1 ? m.home : m.away,
      points = side === 1 ? m.home_score : m.away_score,
      b = s.box.teams[side];
    const selected = courtDetailed ? courtPlayer(courtSelected[side]) : null;
    const button = (kind, label, sub = "", extra = "") =>
      `<button class="court-point ${extra}" data-court-action="${kind}" data-side="${side}" ${editable ? "" : "disabled"}><strong>${label}</strong>${sub ? `<small>${sub}</small>` : ""}</button>`;
    return `<section class="court-team court-team-${side}"><div class="court-team-heading"><span class="court-team-tag">${side === 1 ? "HOME" : "AWAY"}</span><h3>${esc(name)}</h3><span class="court-possession ${g.possession === side ? "has-ball" : ""}">${g.possession === side ? "● " + ct("Possession") : ""}</span></div><div class="court-score" data-court-score="${side}">${points}</div><div class="court-team-counts"><span><b>${b.fouls_period}</b> ${ct("Foul")} ${g.profile === "streetball" ? "· game" : "· " + courtPeriod()}</span><span><b>${b.timeouts}</b> ${ct("Timeout")}</span></div>${canScore() ? `<div class="court-attribution">${courtDetailed ? esc(courtPlayerName(selected)) : ct("Team / unassigned")}${selected ? `<button data-court-clear="${side}" aria-label="Clear selected player">×</button>` : ""}</div><div class="court-point-buttons">${g.profile === "streetball" ? button("one_made", "+1", "Inside arc") : button("two_made", "+2", "Field goal")}${g.profile === "streetball" ? button("two_made", "+2", "Outside arc") : button("three_made", "+3", "3-pointer")}${button("free_throw_made", "+1", ct("Free throw"), "free-throw")}</div><div class="court-secondary-buttons"><button data-court-action="personal_foul" data-side="${side}" ${editable ? "" : "disabled"}>${ct("Foul")} +</button><button data-court-action="timeout" data-side="${side}" ${editable ? "" : "disabled"}>${ct("Timeout")}</button><button data-court-control="possession" data-side="${side}" ${editable && !pending ? "" : "disabled"} aria-label="${esc(ct("Possession"))} ${side}">⇄</button></div>` : ""}</section>`;
  };
  const last = s.events.find((e) => e.undoable);
  const connection = `<div class="court-sync ${courtOffline || courtQueueError ? "is-error" : ""}" role="status">${courtQueueError ? esc(courtQueueError) : pending ? `Saving ${pending} play${pending === 1 ? "" : "s"}…` : courtOffline ? "Connection lost · waiting to reconnect" : "● Shared live · saved scores"}${courtQueueError ? `<button id="court-retry">${ct("Retry")}</button><button id="court-discard">${ct("Discard")}</button>` : ""}</div>`;
  const clock = `<div class="court-clock-bar"><span class="badge ${m.status}">${tr(m.status)}</span><div><span class="court-period">${courtPeriod()}</span><time id="court-clock" class="${s.clock.running ? "running" : ""}">${courtTime(s.clock.remaining_ms)}</time></div><span class="court-preset">${g.profile === "streetball" ? "1 / 2 · Streetball" : "2 / 3 · Basketball"}</span></div>`;
  const controls = canScore()
    ? `<div class="court-game-controls"><button data-court-control="${s.clock.running ? "clock_pause" : "clock_start"}" ${editable && !pending ? "" : "disabled"}>${ct(s.clock.running ? "Pause" : "Start clock")}</button><button data-court-control="set_clock" ${editable && !pending ? "" : "disabled"}>${ct("Set clock")}</button><button data-court-control="next_period" ${editable && !pending ? "" : "disabled"}>${ct("Next period")}</button><button data-court-control="profile" ${editable && !pending ? "" : "disabled"}>${ct("Game setup")}</button><button id="court-undo-last" ${editable && last && !pending ? "" : "disabled"}>↶ ${ct("Undo last play")}</button><button class="court-finish" data-court-control="${m.status === "COMPLETED" ? "resume" : "finish"}" ${courtReady() && !pending ? "" : "disabled"}>${ct(m.status === "COMPLETED" ? "Reopen game" : "Finish game")}</button></div>`
    : "";
  return (
    picker +
    `<div id="court-board">${connection}${clock}<div class="court-teams">${teamPanel(1)}${teamPanel(2)}</div>${controls}</div><div class="court-mode-switch"><button data-court-mode="quick" class="${!courtDetailed ? "active" : ""}">${ct("Quick score")}</button><button data-court-mode="players" class="${courtDetailed ? "active" : ""}">${ct("Player stats")}</button><span>${courtDetailed ? "Tap a player, then a play. Team-only entries are always available." : "Large buttons. No roster required. The clock is optional."}</span></div>${courtDetailed ? renderCourtPlayers(editable) : ""}${canScore() ? `<details class="court-adjust"><summary>Score corrections</summary><p>Use Undo for a recorded play. For earlier or unassigned points, adjust the team total here.</p><div>${[1, 2].map((side) => `<span>${esc(side === 1 ? m.home : m.away)} <button data-court-action="adjust_minus" data-side="${side}" ${editable ? "" : "disabled"}>−1</button><button data-court-action="adjust_plus" data-side="${side}" ${editable ? "" : "disabled"}>+1</button></span>`).join("")}</div></details>` : ""}${renderCourtLog(editable)}`
  );
}

function renderCourtPlayers(editable) {
  const s = courtState,
    side = courtPlayerSide,
    teamId = side === 1 ? s.match.home_team_id : s.match.away_team_id;
  const roster = s.roster.filter((p) => p.team_id === teamId),
    selected = courtPlayer(courtSelected[side]);
  const actions = [
    [
      s.game.profile === "streetball" ? "one_made" : "two_made",
      s.game.profile === "streetball" ? "+1 · Inside arc" : "+2 · Field goal",
    ],
    [
      s.game.profile === "streetball" ? "two_made" : "three_made",
      s.game.profile === "streetball" ? "+2 · Outside arc" : "+3 · 3-pointer",
    ],
    ["free_throw_made", "+1 · Free throw"],
    ["personal_foul", "Foul"],
    [
      s.game.profile === "streetball" ? "one_missed" : "two_missed",
      s.game.profile === "streetball" ? "Missed 1PT" : "Missed 2PT",
    ],
    [
      s.game.profile === "streetball" ? "two_missed" : "three_missed",
      s.game.profile === "streetball" ? "Missed 2PT" : "Missed 3PT",
    ],
    ["free_throw_missed", "Missed FT"],
    ["offensive_rebound", "Off. rebound"],
    ["defensive_rebound", "Def. rebound"],
    ["assist", "Assist"],
    ["steal", "Steal"],
    ["block", "Block"],
    ["turnover", "Turnover"],
    ["technical_foul", "Technical foul"],
    ["unsportsmanlike_foul", "Unsportsmanlike"],
    ["violation", "Violation"],
    ["sub_in", "Sub in"],
    ["sub_out", "Sub out"],
  ];
  return `<section class="court-player-section"><div class="section-head"><h3>${ct("Player stats")}</h3>${role() === "OWNER" && teamId ? `<button id="court-add-players">＋ ${ct("Add players")}</button>` : ""}</div><div class="court-team-tabs">${[1, 2].map((n) => `<button data-court-player-side="${n}" class="${n === side ? "active" : ""}">${esc(n === 1 ? s.match.home : s.match.away)}</button>`).join("")}</div><div class="court-player-cards">${
    roster
      .map((p) => {
        const b = s.box.players[p.id];
        return `<button data-court-player="${p.id}" class="court-player-card ${p.id === courtSelected[side] ? "selected" : ""}"><span class="court-player-name">${p.jersey ? `<b>#${esc(p.jersey)}</b>` : ""}${esc(p.name)}${b.on_court !== null ? `<small>${b.on_court ? "ON" : "OFF"}</small>` : ""}</span><span class="court-player-numbers"><span><b>${b.pts}</b>PTS</span><span><b>${b.oreb + b.dreb}</b>REB</span><span><b>${b.ast}</b>AST</span><span><b>${b.pf}</b>PF</span></span><small class="court-shooting">FG ${b.fgm}/${b.fga} · 3PT ${b.tpm}/${b.tpa} · FT ${b.ftm}/${b.fta} · STL ${b.stl} · BLK ${b.blk} · TO ${b.to}${b.tf ? " · TF " + b.tf : ""}${b.uf ? " · UF " + b.uf : ""}</small></button>`;
      })
      .join("") ||
    `<div class="empty">No players added yet. ${role() === "OWNER" ? "Add names and optional jersey numbers above." : "An organizer can add the roster. You can still record team-only plays."}</div>`
  }</div><div class="court-unassigned">Team-only / earlier points: <b>${s.box.teams[side].unassigned_points}</b>. Shooting attempts count the makes and misses actually recorded.</div>${canScore() ? `<div id="court-recording" class="court-player-actions"><div class="court-recording-for">Recording for <strong>${esc(courtPlayerName(selected))}</strong>${selected ? `<button data-court-clear="${side}">×</button>` : ""}</div><div>${actions.map(([kind, label]) => `<button data-court-action="${kind}" data-side="${side}" ${editable && (!kind.startsWith("sub_") || selected) ? "" : "disabled"}>${ct(label)}</button>`).join("")}</div><p>Fouls are logged as events. Record any awarded free throws with the free-throw buttons; foul buttons never add points.</p></div>` : ""}</section>`;
}

function renderCourtLog(editable) {
  return `<section class="court-log"><div class="section-head"><h3>${ct("Play-by-play")}</h3><span>Who, what, and when · latest 60 entries</span></div>${
    courtState.events
      .map((e) => {
        const p = courtPlayer(e.player_id),
          side =
            e.side === 1
              ? courtState.match.home
              : e.side === 2
                ? courtState.match.away
                : "";
        return `<article class="court-log-entry ${e.undone_at ? "undone" : ""}" data-court-event="${e.id}"><span class="court-log-clock">${courtPeriod(e.period)}<time>${courtTime(e.clock_ms)}</time></span><div><strong>${esc(ct(courtLabels[e.kind] || e.kind))}</strong><span>${esc(side)}${p ? " · " + esc(courtPlayerName(p)) : ""}</span><small>${esc(e.actor)} · ${new Date(e.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${e.undone_at ? " · Undone by " + esc(e.undone_by) : ""}</small></div>${canScore() && e.undoable ? `<button data-court-undo="${e.id}" ${editable && !courtPending() ? "" : "disabled"}>${ct("Undo")}</button>` : ""}</article>`;
      })
      .join("") ||
    `<div class="empty">No plays logged yet. Existing scores are preserved; new scoring plays will appear here.</div>`
  }</section>`;
}

async function loadCourt(force = false) {
  if (courtLoading || !courtMatchId || tab !== "Live Court") return;
  courtLoading = true;
  const requestedMid = courtMatchId,
    requestedTid = tid;
  try {
    const previous = courtState;
    const since =
      !force && previous?.match.id === requestedMid
        ? "?since=" + previous.version
        : "";
    const data = await api(
      `/live/tournaments/${requestedTid}/basketball/matches/${requestedMid}` +
        since,
    );
    if (requestedTid !== tid || requestedMid !== courtMatchId) return;
    courtOffline = false;
    courtClockMark = performance.now();
    if (data.unchanged) {
      if (courtState) courtState.clock = data.clock;
      updateCourtClock();
      return;
    }
    if (
      courtState?.match.id === requestedMid &&
      courtState.version > data.version
    )
      return;
    courtState = data;
    if (tab === "Live Court") render();
  } catch (e) {
    courtOffline = true;
    const node = document.querySelector(".court-loading,.court-sync");
    if (node) node.textContent = "Connection unavailable. Retrying…";
  } finally {
    courtLoading = false;
  }
}

function courtAddPlay(kind, side, extras = {}) {
  if (!courtReady()) return;
  let player = courtDetailed ? courtSelected[side] || null : null;
  if (["timeout", "adjust_plus", "adjust_minus"].includes(kind)) player = null;
  const body = {
    request_id: crypto.randomUUID(),
    kind,
    side: side || null,
    player_id: player,
    profile: courtState.game.profile,
    ...extras,
  };
  courtQueue.push({
    tid,
    mid: courtMatchId,
    user_id: user.id,
    body,
    path: "plays",
  });
  courtSaveQueue();
  courtQueueError = "";
  render();
  drainCourtQueue();
}

async function drainCourtQueue() {
  if (
    courtSending ||
    !courtQueue.length ||
    !user ||
    courtQueueError ||
    courtQueue[0].user_id !== user.id
  )
    return;
  courtSending = true;
  try {
    while (courtQueue.length) {
      const item = courtQueue[0];
      if (item.user_id !== user.id) break;
      let success = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await api(
            `/live/tournaments/${item.tid}/basketball/matches/${item.mid}/` +
              item.path,
            { method: "POST", body: JSON.stringify(item.body) },
          );
          success = true;
          break;
        } catch (e) {
          if (attempt === 0 && (!e.status || e.status >= 500)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            continue;
          }
          courtQueueError =
            e.message ||
            "Could not confirm that play. Retry safely with the same request ID.";
          courtErrorStatus = e.status;
        }
      }
      if (!success) break;
      courtQueue.shift();
      courtSaveQueue();
      if (tab === "Live Court" && item.tid === tid && item.mid === courtMatchId)
        await loadCourt(true);
    }
  } finally {
    courtSending = false;
    if (tab === "Live Court") render();
    if (!courtQueue.length) await load(true);
  }
}

async function courtUndo(id) {
  if (!courtReady() || courtPending()) return;
  courtQueue.push({
    tid,
    mid: courtMatchId,
    user_id: user.id,
    path: `plays/${id}/undo`,
    body: { request_id: crypto.randomUUID(), version: courtState.version },
  });
  courtSaveQueue();
  courtQueueError = "";
  render();
  drainCourtQueue();
}

function courtControl(kind, side) {
  if (courtPending()) return;
  if (kind === "profile") return courtSetup();
  if (kind === "set_clock") return courtSetClock();
  if (kind === "finish") return courtFinish();
  courtAddPlay(kind, side, { player_id: null, version: courtState.version });
}

function courtSetup() {
  const g = courtState.game;
  const version = courtState.version;
  modal(
    `<h2>${ct("Game setup")}</h2><p>Choose your scoring format before recording plays. Start the optional clock only when you are ready to run it.</p><form id="court-setup"><label>Scoring preset<select name="profile"><option value="standard" ${g.profile === "standard" ? "selected" : ""}>Basketball · 2 / 3 points + free throws</option><option value="streetball" ${g.profile === "streetball" ? "selected" : ""}>Streetball / 3×3 · 1 / 2 points + free throws</option></select></label><label>Periods for basketball<select name="period_count"><option value="4" ${g.period_count === 4 ? "selected" : ""}>4 quarters</option><option value="2" ${g.period_count === 2 ? "selected" : ""}>2 halves</option><option value="1" ${g.period_count === 1 ? "selected" : ""}>1 period</option></select></label><label>Minutes per period<input name="minutes" type="number" min="1" max="60" value="${g.period_seconds / 60}" required></label><p class="muted">Streetball uses one period. The next period after regulation is overtime; finish is always confirmed manually.</p><button type="submit">Save game setup</button></form>`,
  );
  $("#court-setup").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $("#dialog").close();
    courtAddPlay("profile", null, {
      player_id: null,
      version,
      profile: f.get("profile"),
      period_count: Number(f.get("period_count")),
      period_seconds: Number(f.get("minutes")) * 60,
    });
  };
}

function courtSetClock() {
  const total = Math.ceil(courtState.clock.remaining_ms / 1000);
  const version = courtState.version;
  modal(
    `<h2>${ct("Set clock")}</h2><form id="court-clock-form"><div class="form-row"><label>Minutes<input name="minutes" type="number" min="0" max="120" value="${Math.floor(total / 60)}" required></label><label>Seconds<input name="seconds" type="number" min="0" max="59" value="${total % 60}" required></label></div><button type="submit">Set remaining time</button></form>`,
  );
  $("#court-clock-form").onsubmit = (e) => {
    e.preventDefault();
    let f = new FormData(e.target);
    $("#dialog").close();
    courtAddPlay("set_clock", null, {
      player_id: null,
      version,
      seconds: Number(f.get("minutes")) * 60 + Number(f.get("seconds")),
    });
  };
}

function courtFinish() {
  const m = courtState.match;
  const version = courtState.version;
  modal(
    `<h2>${ct("Finish game")}</h2><p>${esc(m.home)} <strong>${m.home_score} – ${m.away_score}</strong> ${esc(m.away)}</p><p>Confirm the final score to update the standings and advance knockout winners.</p><form id="court-finish-form">${m.type === "SINGLE_ELIMINATION" && m.home_score === m.away_score ? `<label>Penalty / overtime winner<select name="winner" required><option value="">Choose a winner</option><option value="1">${esc(m.home)}</option><option value="2">${esc(m.away)}</option></select></label>` : ""}<button type="submit">Confirm final result</button></form>`,
  );
  $("#court-finish-form").onsubmit = (e) => {
    e.preventDefault();
    let f = new FormData(e.target);
    $("#dialog").close();
    courtAddPlay("finish", null, {
      player_id: null,
      version,
      tiebreak_winner: f.get("winner") ? Number(f.get("winner")) : null,
    });
  };
}

function courtRosterModal() {
  const side = courtPlayerSide,
    teamId =
      side === 1
        ? courtState.match.home_team_id
        : courtState.match.away_team_id;
  modal(
    `<h2>${ct("Add players")}</h2><p>One player per line. Optional jersey number first, for example “7 Alex”. Existing players stay on the roster.</p><form id="court-roster-form"><label>Players<textarea name="players" required placeholder="7 Alex&#10;12 Maya&#10;Jordan"></textarea></label><p class="error" role="alert"></p><button type="submit">Add to ${esc(side === 1 ? courtState.match.home : courtState.match.away)}</button></form>`,
  );
  $("#court-roster-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const lines = new FormData(e.target)
        .get("players")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const players = lines.map((line) => {
        const m = line.match(/^(\d{1,3})\s+(.+)$/);
        return m ? { jersey: m[1], name: m[2] } : { name: line, jersey: "" };
      });
      await api(`/live/tournaments/${tid}/basketball/teams/${teamId}/players`, {
        method: "POST",
        body: JSON.stringify({ players }),
      });
      $("#dialog").close();
      await loadCourt(true);
      await load(true);
    } catch (err) {
      $("#court-roster-form .error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}

function bindCourt() {
  if (tab !== "Live Court") return;
  const picker = $("#court-match");
  if (picker)
    picker.onchange = (e) => {
      courtMatchId = Number(e.target.value);
      courtState = null;
      courtSelected = { 1: null, 2: null };
      let address = new URL(location.href);
      address.searchParams.set("match", courtMatchId);
      history.replaceState({}, "", address);
      render();
    };
  if ($("#court-fullscreen"))
    $("#court-fullscreen").onclick = () =>
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement
            .requestFullscreen()
            .catch(() => toast("Fullscreen is not available in this browser"));
  $$("[data-court-action]").forEach(
    (b) =>
      (b.onclick = () =>
        courtAddPlay(b.dataset.courtAction, Number(b.dataset.side))),
  );
  $$("[data-court-control]").forEach(
    (b) =>
      (b.onclick = () =>
        courtControl(
          b.dataset.courtControl,
          b.dataset.side ? Number(b.dataset.side) : null,
        )),
  );
  $$("[data-court-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        courtDetailed = b.dataset.courtMode === "players";
        render();
      }),
  );
  $$("[data-court-player-side]").forEach(
    (b) =>
      (b.onclick = () => {
        courtPlayerSide = Number(b.dataset.courtPlayerSide);
        render();
      }),
  );
  $$("[data-court-player]").forEach(
    (b) =>
      (b.onclick = () => {
        courtSelected[courtPlayerSide] = Number(b.dataset.courtPlayer);
        render();
        $("#court-recording")?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }),
  );
  $$("[data-court-clear]").forEach(
    (b) =>
      (b.onclick = () => {
        courtSelected[Number(b.dataset.courtClear)] = null;
        render();
      }),
  );
  $$("[data-court-undo]").forEach(
    (b) => (b.onclick = () => courtUndo(Number(b.dataset.courtUndo))),
  );
  if ($("#court-undo-last"))
    $("#court-undo-last").onclick = () => {
      const last = courtState.events.find((e) => e.undoable);
      if (last) courtUndo(last.id);
    };
  if ($("#court-add-players"))
    $("#court-add-players").onclick = courtRosterModal;
  if ($("#court-discard"))
    $("#court-discard").onclick = () => {
      courtQueue.shift();
      courtSaveQueue();
      courtQueueError = "";
      render();
      drainCourtQueue();
    };
  if ($("#court-retry"))
    $("#court-retry").onclick = async () => {
      await loadCourt(true);
      const item = courtQueue[0];
      if (courtErrorStatus === 409 && item?.body.version != null) {
        item.body.version = courtState.version;
        item.body.request_id = crypto.randomUUID();
        courtSaveQueue();
      }
      courtQueueError = "";
      drainCourtQueue();
      render();
    };
  if (!courtState || courtState.match.id !== courtMatchId) loadCourt();
  if (user && courtQueue.length && !courtQueueError) drainCourtQueue();
  updateCourtClock();
}

function updateCourtClock() {
  if (!courtState || tab !== "Live Court") return;
  const time = $("#court-clock");
  if (!time) return;
  let remaining =
    courtState.clock.remaining_ms -
    (courtState.clock.running ? performance.now() - courtClockMark : 0);
  time.textContent = courtTime(remaining);
  if (remaining <= 0 && courtState.clock.running) {
    courtState.clock.running = false;
    courtState.clock.remaining_ms = 0;
    render();
  }
}
setInterval(updateCourtClock, 250);
setInterval(() => {
  if (
    typeof tab !== "undefined" &&
    tab === "Live Court" &&
    !document.hidden &&
    !courtSending
  )
    loadCourt();
}, 2000);
