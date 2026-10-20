const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const apiOrigin = window.BIBER_API_ORIGIN || "";
$("#source-download").href = apiOrigin + "/source.zip";
let token = sessionStorage.getItem("bracket-token"),
  user = null,
  state = null,
  tid = Number(new URLSearchParams(location.search).get("t")) || null,
  tab = "Groups",
  filter = "All",
  lang = localStorage.getItem("language") || "en",
  polling = false;
const words = {
  Diagram: "תרשים הטורניר",
  Groups: "בתים",
  Matches: "משחקים",
  Standings: "טבלה",
  Knockout: "שלב הנוקאאוט",
  All: "הכל",
  LIVE: "בשידור חי",
  COMPLETED: "הסתיים",
  PENDING: "ממתין",
  "Sign in": "כניסה",
  "Sign out": "יציאה",
  "Public viewer · Read only": "צופה ציבורי · צפייה בלבד",
  "Edit score": "עדכון תוצאה",
  "Recent matches": "משחקים אחרונים",
  "Group standings": "טבלאות הבתים",
  "Save result": "שמירת תוצאה",
  "Live · Synced": "מחובר · מסונכרן",
  "The latest": "עדכונים אחרונים",
  "New tournament": "טורניר חדש",
};
const tr = (s) => (lang === "he" ? words[s] || s : s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(path, opt = {}) {
  let r = await fetch(apiOrigin + "/api" + path, {
    ...opt,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
      ...opt.headers,
    },
  });
  if (!r.ok) {
    let e = await r.json().catch(() => ({ detail: r.statusText }));
    let msg =
      typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
    let err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}
let toastTimer;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6000);
}
function modal(html) {
  $("#modal").innerHTML = html;
  $("#dialog").showModal();
  $("#dialog .close").onclick = () => $("#dialog").close();
}
const allItems = () => state?.stages.flatMap((s) => s.stage_items) || [];
const allMatches = () =>
  allItems().flatMap((i) =>
    i.rounds.flatMap((r) =>
      r.matches.map((m) => ({
        ...m,
        item: i.name,
        itemId: i.id,
        type: i.type,
        round: r.name,
      })),
    ),
  );
const role = () =>
  user?.memberships.find((m) => m.club_id === state?.tournament.club_id)
    ?.relation;
const canScore = () => ["OWNER", "COLLABORATOR"].includes(role());
function team(m, n) {
  let i = m["stage_item_input" + n];
  if (i?.winner_from_stage_item_id && !i.team)
    return (
      (allItems().find((g) => g.id === i.winner_from_stage_item_id)?.name ||
        "Group") +
      " #" +
      i.winner_position
    );
  return (
    i?.team?.name ||
    (m["stage_item_input" + n + "_winner_from_match_id"]
      ? "Winner #" + m["stage_item_input" + n + "_winner_from_match_id"]
      : "TBD")
  );
}
function table(item, full = false) {
  let rows = state.standings[item.id] || [];
  return `<table data-table="${item.id}"><thead><tr><th>#</th><th>${lang === "he" ? "קבוצה" : "TEAM"}</th><th>P</th>${full ? "<th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th>" : ""}<th>GD</th><th>PTS</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${i < state.tournament.qualify ? "qualified" : ""}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.wins + r.draws + r.losses}</td>${full ? `<td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${r.goals_for}</td><td>${r.goals_against}</td>` : ""}<td>${r.goals_for - r.goals_against > 0 ? "+" : ""}${r.goals_for - r.goals_against}</td><td>${Number(r.points)}</td></tr>`).join("")}</tbody></table>`;
}
function card(m, knockout = false) {
  return `<article class="match-card" data-match="${m.id}"><span class="badge ${m.live_status}">${tr(m.live_status)}</span><div class="match-info"><small>${esc(m.item)} · ${esc(m.round)} · #${m.id}</small><div class="teams"><span class="team-name">${esc(team(m, 1))}</span><b class="score-display">${m.stage_item_input1_score} – ${m.stage_item_input2_score}</b><span class="team-name">${esc(team(m, 2))}</span></div>${m.tiebreak_winner ? `<small>Penalty / overtime winner: ${esc(team(m, m.tiebreak_winner))}</small>` : ""}</div>${canScore() ? `<button class="edit" data-edit="${m.id}" ${!m.stage_item_input1?.team || !m.stage_item_input2?.team ? "disabled" : ""}>${tr("Edit score")}</button>` : ""}</article>`;
}
function render() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  $("#language").textContent = lang === "en" ? "עברית" : "English";
  $("#auth").textContent = tr(user ? "Sign out" : "Sign in");
  $("#identity").textContent = user
    ? `${user.name} · ${role() === "OWNER" ? "Organizer" : role() === "COLLABORATOR" ? "Scorekeeper" : "Read only"}`
    : tr("Public viewer · Read only");
  $("#new").hidden = !user?.memberships.some((m) => m.relation === "OWNER");
  if (!state) return;
  $("#title").textContent = state.tournament.name;
  $("#subtitle").textContent =
    lang === "he"
      ? "כל תוצאה. כל קבוצה. טורניר משותף אחד."
      : "Every result. Every team. One shared tournament.";
  $("#feed-title").textContent = tr("The latest");
  $("#admin").hidden = role() !== "OWNER";
  $(".workspace").classList.toggle("diagram-mode", tab === "Diagram");
  $("#tabs").innerHTML = [
    "Groups",
    "Matches",
    "Standings",
    "Knockout",
    "Diagram",
  ]
    .map(
      (t) =>
        `<button class="${t === tab ? "active" : ""}" data-tab="${t}">${tr(t)}</button>`,
    )
    .join("");
  let matches = allMatches(),
    groups = allItems().filter((i) => i.type === "ROUND_ROBIN"),
    completed = matches.filter((m) => m.live_status === "COMPLETED").length;
  $("#stats").innerHTML = [
    [
      state.stages[0]?.stage_items.reduce((n, g) => n + g.team_count, 0) || 0,
      lang === "he" ? "קבוצות" : "Teams",
      "Ready to compete",
    ],
    [groups.length, lang === "he" ? "בתים" : "Groups", "Round-robin format"],
    [
      completed + "/" + matches.length,
      lang === "he" ? "משחקים הושלמו" : "Matches complete",
      matches.filter((m) => m.live_status === "LIVE").length +
        " live right now",
    ],
    [
      groups.length * state.tournament.qualify,
      lang === "he" ? "עולים" : "Qualifying spots",
      "The road to the final",
    ],
  ]
    .map(
      ([n, l, s]) =>
        `<div class="stat"><span>${l}</span><b>${n}</b><small>${s}</small></div>`,
    )
    .join("");
  let html = "";
  if (tab === "Groups" || tab === "Standings") {
    html = `<div class="section-head"><h2>${tr("Group standings")}</h2><span>${groups.length} groups · Top ${state.tournament.qualify} advance</span></div><div class="${tab === "Groups" ? "groups" : "match-list"}">${groups
      .map((g) => {
        let ms = matches.filter((m) => m.itemId === g.id),
          done = ms.filter((m) => m.live_status === "COMPLETED").length;
        return `<section class="group"><div class="group-head"><strong>${esc(g.name)}</strong><small>${g.team_count} TEAMS</small></div>${table(g, tab === "Standings")}<div class="group-foot"><span>${done} / ${ms.length} matches complete</span><button data-group="${g.id}">View matches →</button></div></section>`;
      })
      .join(
        "",
      )}</div><p class="legend"><i></i> Qualification positions · P played / GD goal difference / PTS points</p>`;
    if (tab === "Groups")
      html += `<div class="section-head"><h2>${tr("Recent matches")}</h2><span>Shared with every device</span></div><div class="match-list">${matches
        .filter((m) => m.live_status === "LIVE")
        .slice(0, 3)
        .map((m) => card(m))
        .join("")}</div>`;
  }
  if (tab === "Matches") {
    html = `<div class="filters">${["All", "LIVE", "COMPLETED", "PENDING", ...groups.map((g) => g.name)].map((f) => `<button class="${filter === f ? "active" : ""}" data-filter="${esc(f)}">${tr(f)}</button>`).join("")}</div><div class="match-list">${matches
      .filter(
        (m) =>
          filter === "All" || m.live_status === filter || m.item === filter,
      )
      .map((m) => card(m))
      .join("")}</div>`;
  }
  if (tab === "Knockout") {
    let ko = allItems().find((i) => i.type === "SINGLE_ELIMINATION");
    html = `<div class="section-head"><h2>${tr("Knockout")}</h2><span>Win. Advance. Repeat.</span></div>`;
    if (!ko)
      html += `<div class="empty"><h3>The road to the final</h3><p>${groups.length * state.tournament.qualify} qualifiers → ${(groups.length * state.tournament.qualify) / 2} opening matches → semifinals → final.</p><p>Complete every group result. The organizer can then generate the seeded bracket.</p><p>Tied group rankings: points → goal difference → goals scored → stable input order. Tied knockout games require an explicit penalty/overtime winner.</p></div>`;
    else
      html += `<div class="knockout">${ko.rounds.map((r, i) => `<section class="ko-round"><h3>${["FINAL", "SEMIFINALS", "QUARTERFINALS", "ROUND OF 16", "ROUND OF 32"][ko.rounds.length - 1 - i]}</h3>${r.matches.map((m) => card({ ...m, item: ko.name, round: r.name }, true)).join("")}</section>`).join("")}</div>`;
  }
  if (tab === "Diagram") html = renderDiagram();
  $("#content").innerHTML = html;
  bindDiagramControls();
  $("#feed").innerHTML = state.audit.length
    ? state.audit
        .slice(0, 7)
        .map((a) => {
          let data = JSON.parse(a.after);
          return `<div class="feed-item"><time>${new Date(a.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${esc(a.actor)}</time>${data.action ? esc(data.action === "reset" ? "Demonstration reset" : "Groups reshuffled") : `<strong>Match #${a.match_id}</strong> updated to <strong>${data.home} – ${data.away}</strong><br>${tr(data.status)}`}</div>`;
        })
        .join("")
    : '<div class="feed-item"><strong>Welcome to match day.</strong><br>Live score changes appear here automatically. Open this page on another device to follow along.</div>';
  $("#rules").textContent =
    "Only completed matches count toward standings. Points → goal difference → goals scored → stable input order. Pending and live results remain provisional.";
  $("#seed-rule").textContent =
    `Top ${state.tournament.qualify} per group advance. For 4 × 2: A1–B2, C1–D2, B1–A2, D1–C2. Ties in knockout require a penalty/overtime winner.`;
  $$("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        render();
      }),
  );
  $$("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        render();
      }),
  );
  $$("[data-group]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = "Matches";
        filter = allItems().find((i) => i.id == b.dataset.group).name;
        render();
      }),
  );
  $$("[data-edit]").forEach(
    (b) => (b.onclick = () => edit(Number(b.dataset.edit))),
  );
}
async function load(force = false) {
  if (!tid || polling) return;
  polling = true;
  try {
    const data = await api(
      "/live/tournaments/" +
        tid +
        (!force && state ? "?since=" + state.tournament.revision : ""),
    );
    $("#connection").textContent = tr("Live · Synced");
    if (data.unchanged) return;
    let changed =
      state && data.tournament.revision !== state.tournament.revision;
    let old = state;
    state = data;
    if (force || !old || changed) {
      render();
      if (changed && data.audit[0]?.id !== old.audit[0]?.id) {
        toast(`${data.audit[0]?.actor || "Organizer"} updated the tournament`);
        let m = data.audit[0]?.match_id;
        document.querySelector(`[data-match="${m}"]`)?.classList.add("changed");
      }
    }
  } catch (e) {
    $("#connection").textContent = "Offline · retrying";
    if (!state)
      $("#content").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  } finally {
    polling = false;
  }
}
function edit(id) {
  let m = allMatches().find((m) => m.id === id);
  modal(
    `<div class="kicker" style="color:#ff9aaa">MATCH #${id} · ${esc(m.item)}</div><h2>${tr("Edit score")}</h2><p>Changes are shared with every connected device.</p><form id="score-form"><div class="score-inputs"><label>${esc(team(m, 1))}<input name="home" aria-label="Home score" type="number" min="0" max="999" value="${m.stage_item_input1_score}" required></label><label>${esc(team(m, 2))}<input name="away" aria-label="Away score" type="number" min="0" max="999" value="${m.stage_item_input2_score}" required></label></div><label>Match status<select name="status">${["PENDING", "LIVE", "COMPLETED"].map((s) => `<option ${m.live_status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>${m.type === "SINGLE_ELIMINATION" ? `<label>Penalty / overtime winner (if tied)<select name="tiebreak"><option value="">Choose if tied</option><option value="1">${esc(team(m, 1))}</option><option value="2">${esc(team(m, 2))}</option></select></label>` : ""}<p class="error" role="alert"></p><button type="submit">${tr("Save result")}</button><button type="button" id="latest" hidden>Load latest score</button></form>`,
  );
  let form = $("#score-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    let f = new FormData(form);
    let submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await api(`/live/tournaments/${tid}/matches/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          version: m.live_version,
          home: Number(f.get("home")),
          away: Number(f.get("away")),
          status: f.get("status"),
          tiebreak_winner: f.get("tiebreak") ? Number(f.get("tiebreak")) : null,
        }),
      });
      $("#dialog").close();
      toast("Result saved · shared with every device");
      await load(true);
    } catch (err) {
      form.querySelector(".error").textContent = err.message;
      if (err.status === 409) {
        $("#latest").hidden = false;
        $("#latest").onclick = async () => {
          await load(true);
          edit(id);
        };
      }
    } finally {
      submit.disabled = false;
    }
  };
}
function login() {
  modal(
    `<h2>${tr("Sign in")}</h2><p>Your own account. The same shared tournament.</p><form id="login"><label>Email or username<input name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><p class="error" role="alert"></p><button type="submit">${tr("Sign in")}</button></form>`,
  );
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    let f = new FormData(e.target),
      button = e.target.querySelector("button");
    button.disabled = true;
    try {
      let r = await fetch(apiOrigin + "/api/token", {
        method: "POST",
        body: new URLSearchParams({
          username: f.get("email"),
          password: f.get("password"),
        }),
      });
      let d = await r.json();
      if (!r.ok) throw Error(d.detail);
      token = d.access_token;
      sessionStorage.setItem("bracket-token", token);
      user = await api("/live/me");
      $("#dialog").close();
      await load(true);
      render();
    } catch (err) {
      $("#login .error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
$("#auth").onclick = () => {
  if (user) {
    token = null;
    user = null;
    sessionStorage.removeItem("bracket-token");
    render();
  } else login();
};
$("#language").onclick = () => {
  lang = lang === "en" ? "he" : "en";
  localStorage.setItem("language", lang);
  render();
};
$("#new").onclick = () => {
  modal(
    `<h2>${tr("New tournament")}</h2><p>Bulk enter one team per line. Teams are distributed evenly and Bracket generates every round-robin fixture.</p><form id="setup"><label>Tournament name<input name="name" required maxlength="100"></label><label>Teams · one per line<textarea name="teams" required placeholder="Harbor Hawks&#10;Desert Foxes&#10;…"></textarea></label><div class="form-row"><label>Groups (בתים)<input name="groups" type="number" value="4" min="2" max="16" required></label><label>Qualify per group<input name="qualify" type="number" value="2" min="1" max="4" required></label><label>Win points<input name="win_points" type="number" value="3" min="1" max="10"></label><label>Draw points<input name="draw_points" type="number" value="1" min="0" max="10"></label></div><label>Distribution<select name="shuffle"><option value="yes">Random shuffle</option><option value="no">Preserve entry order</option></select></label><p class="error" role="alert"></p><button type="submit">Create groups & fixtures →</button></form>`,
  );
  $("#setup").onsubmit = async (e) => {
    e.preventDefault();
    let f = new FormData(e.target),
      b = e.target.querySelector("button");
    b.disabled = true;
    try {
      let d = await api("/live/tournaments", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          teams: f
            .get("teams")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          groups: Number(f.get("groups")),
          qualify: Number(f.get("qualify")),
          win_points: Number(f.get("win_points")),
          draw_points: Number(f.get("draw_points")),
          shuffle: f.get("shuffle") === "yes",
        }),
      });
      tid = d.id;
      state = null;
      $("#dialog").close();
      await refreshList();
      await load(true);
    } catch (err) {
      $("#setup .error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
};
$("#qualify").onclick = async () => {
  try {
    await api(`/live/tournaments/${tid}/qualify`, { method: "POST" });
    tab = "Knockout";
    await load(true);
  } catch (e) {
    toast(e.message);
  }
};
$("#reset").onclick = () => {
  modal(
    `<h2>Reset demonstration?</h2><p>This clears all results in this tournament, removes its knockout stage, and restores sample group scores. All connected users will see the reset.</p><form id="reset-form"><button type="submit" class="danger">Reset this tournament</button><p class="error" role="alert"></p></form>`,
  );
  $("#reset-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/live/tournaments/${tid}/reset`, { method: "POST" });
      $("#dialog").close();
      await load(true);
    } catch (err) {
      $("#reset-form .error").textContent = err.message;
    }
  };
};
$("#invite").onclick = () => {
  modal(
    `<h2>Add a tournament user</h2><form id="invite-form"><label>Name<input name="name" required maxlength="80"></label><label>Email<input name="email" type="email" required></label><label>Temporary password (12–64 characters)<input name="password" type="password" minlength="12" maxlength="64" required autocomplete="new-password"></label><label>Role<select name="role"><option value="COLLABORATOR">Scorekeeper</option><option value="OWNER">Organizer</option></select></label><p class="error" role="alert"></p><button type="submit">Create independent account</button></form>`,
  );
  $("#invite-form").onsubmit = async (e) => {
    e.preventDefault();
    let b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await api(`/live/tournaments/${tid}/users`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      $("#dialog").close();
      toast("Independent user created");
    } catch (err) {
      $("#invite-form .error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
};
async function refreshList() {
  let list = await api("/live/tournaments");
  $("#tournaments").innerHTML = list
    .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
    .join("");
  if (!tid || !list.some((t) => t.id === tid)) tid = list[0]?.id;
  $("#tournaments").value = tid;
  history.replaceState({}, "", `?t=${tid}`);
}
$("#tournaments").onchange = async (e) => {
  tid = Number(e.target.value);
  state = null;
  history.replaceState({}, "", `?t=${tid}`);
  await load(true);
};
(async () => {
  try {
    if (token) {
      try {
        user = await api("/live/me");
      } catch {
        token = null;
        sessionStorage.removeItem("bracket-token");
      }
    }
    await refreshList();
    await load(true);
    render();
  } catch (e) {
    $("#content").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
  setInterval(() => {
    if (!document.hidden) load();
  }, 2000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
})();

$("#reshuffle").onclick = async () => {
  try {
    await api(`/live/tournaments/${tid}/reshuffle`, { method: "POST" });
    await load(true);
  } catch (e) {
    toast(e.message);
  }
};
