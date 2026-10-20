// A view of Bracket's persisted stages and match dependencies, never a second engine.
let diagramZoom = null;

function renderDiagram() {
  const groups = allItems().filter((i) => i.type === "ROUND_ROBIN");
  const knockout = allItems().find((i) => i.type === "SINGLE_ELIMINATION");
  if (!knockout)
    return `<div class="empty">${lang === "he" ? "תרשים הנוקאאוט יופיע לאחר הגדרת שלב הגמר." : "Set up the knockout stage to see its tournament diagram."}</div>`;
  const rounds = knockout.rounds;
  const groupMatches = groups.flatMap((g) =>
    g.rounds.flatMap((r) => r.matches),
  );
  const completed = groupMatches.filter(
    (m) => m.live_status === "COMPLETED",
  ).length;
  const live = groupMatches.filter((m) => m.live_status === "LIVE").length;
  const qualified = state.tournament.knockout_started;
  const groupLayouts = groups.map((group) => {
    const matches = group.rounds.flatMap((r) => r.matches);
    const showing = matches.filter((m) => m.live_status === "LIVE").slice(0, 2);
    if (!showing.length)
      showing.push(
        ...matches.filter((m) => m.live_status === "COMPLETED").slice(-1),
      );
    return {
      group,
      matches,
      showing,
      height:
        64 +
        (state.standings[group.id]?.length || 0) * 23 +
        showing.length * 32,
    };
  });
  const pitch = 278,
    nodeWidth = 220,
    top = 72;
  const areaHeight = Math.max(
    groupLayouts.reduce((sum, g) => sum + g.height + 24, 0),
    (rounds[0]?.matches.length || 1) * 132,
    360,
  );
  const width = (rounds.length + 2) * pitch + 20;
  const height = areaHeight + 120;
  if (diagramZoom === null)
    diagramZoom =
      innerWidth >= 760
        ? Math.min(
            1,
            (document.querySelector(".workspace").clientWidth - 18) / width,
          )
        : 1;
  const positions = new Map(),
    groupPositions = new Map();
  let nodes = [],
    paths = [];
  const heading = (x, text) =>
    `<div class="diagram-column-label" style="left:${x}px">${esc(text)}</div>`;
  const connect = (from, to, qualification = false) => {
    const middle = from.x + (to.x - from.x) / 2;
    paths.push(
      `<path class="${qualification ? "qualification-link" : "progression-link"}" d="M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}" />`,
    );
  };
  nodes.push(heading(22, lang === "he" ? "שלב הבתים" : "GROUP STAGE"));
  let groupTop = top;
  groupLayouts.forEach(({ group, matches, showing, height: cardHeight }) => {
    const center = groupTop + cardHeight / 2;
    groupPositions.set(group.id, { x: 22 + nodeWidth, y: center });
    const standings = state.standings[group.id] || [];
    nodes.push(
      `<section class="diagram-group" data-diagram-group="${group.id}" style="left:22px;top:${groupTop}px;width:${nodeWidth}px"><button class="diagram-group-title" data-group="${group.id}">${esc(group.name)} <span>↗</span></button><ol>${standings.map((team, rank) => `<li class="${rank < state.tournament.qualify ? "advancing" : ""}"><span class="diagram-rank">${rank + 1}</span><span>${esc(team.name)}</span><b>${Number(team.points)}</b></li>`).join("")}</ol><div class="diagram-group-progress">${matches.filter((m) => m.live_status === "COMPLETED").length}/${matches.length} ${lang === "he" ? "משחקים הסתיימו" : "games finished"}</div>${showing.map((m) => `<button class="diagram-group-score" data-open-court="${m.id}"><span>${esc(team(m, 1))} · ${esc(team(m, 2))}</span><b>${m.stage_item_input1_score}–${m.stage_item_input2_score}</b><small>${tr(m.live_status)}</small></button>`).join("")}</section>`,
    );
    groupTop += cardHeight + 24;
  });
  rounds.forEach((round, roundIndex) => {
    const x = 22 + (roundIndex + 1) * pitch;
    const remaining = rounds.length - roundIndex;
    const title =
      remaining === 1
        ? lang === "he"
          ? "גמר"
          : "FINAL"
        : remaining === 2
          ? lang === "he"
            ? "חצי גמר"
            : "SEMIFINALS"
          : remaining === 3
            ? lang === "he"
              ? "רבע גמר"
              : "QUARTERFINALS"
            : `ROUND OF ${round.matches.length * 2}`;
    nodes.push(heading(x, title));
    round.matches.forEach((match, matchIndex) => {
      const predecessorIds = [
        match.stage_item_input1_winner_from_match_id,
        match.stage_item_input2_winner_from_match_id,
      ];
      const previous = predecessorIds
        .map((id) => positions.get(id))
        .filter(Boolean);
      const y = previous.length
        ? previous.reduce((sum, p) => sum + p.y, 0) / previous.length
        : top + ((matchIndex + 0.5) * areaHeight) / round.matches.length;
      positions.set(match.id, { x, y, width: nodeWidth });
      let winner = null;
      if (match.live_status === "COMPLETED")
        winner =
          match.stage_item_input1_score > match.stage_item_input2_score
            ? 1
            : match.stage_item_input2_score > match.stage_item_input1_score
              ? 2
              : match.tiebreak_winner;
      const row = (side) => {
        const input = match[`stage_item_input${side}`];
        const seedGroup = groups.find(
          (g) => g.id === input?.winner_from_stage_item_id,
        );
        const projected =
          !qualified && seedGroup
            ? state.standings[seedGroup.id]?.[input.winner_position - 1]
            : null;
        const label = projected ? projected.name : team(match, side);
        return `<div class="diagram-team ${winner === side ? "winner" : ""} ${projected ? "provisional" : ""}" ${projected ? 'title="Provisional qualifier from completed group results"' : ""}><span>${esc(label)}</span><b>${match.live_status === "PENDING" ? "–" : match[`stage_item_input${side}_score`]}</b></div>`;
      };
      nodes.push(
        `<article class="diagram-match" data-diagram-match="${match.id}" style="left:${x}px;top:${y - 55}px;width:${nodeWidth}px"><div class="diagram-match-head"><span>#${match.id}</span><span class="badge ${match.live_status}">${tr(match.live_status)}</span></div>${row(1)}${row(2)}${canScore() && match.stage_item_input1?.team && match.stage_item_input2?.team ? `<button class="diagram-edit" data-edit="${match.id}" aria-label="${esc(tr("Edit score"))} #${match.id}">↗</button>` : ""}</article>`,
      );
      [1, 2].forEach((side) => {
        const predecessor = positions.get(
          match[`stage_item_input${side}_winner_from_match_id`],
        );
        if (predecessor)
          connect(
            { x: predecessor.x + nodeWidth, y: predecessor.y },
            { x, y: y + (side === 1 ? -15 : 15) },
          );
        else if (roundIndex === 0) {
          const source = groupPositions.get(
            match[`stage_item_input${side}`]?.winner_from_stage_item_id,
          );
          if (source)
            connect(source, { x, y: y + (side === 1 ? -15 : 15) }, true);
        }
      });
    });
  });
  const final = rounds.at(-1)?.matches[0];
  const finalPosition = final && positions.get(final.id);
  if (finalPosition) {
    const x = 22 + (rounds.length + 1) * pitch;
    const winner =
      final.live_status === "COMPLETED"
        ? final.stage_item_input1_score > final.stage_item_input2_score
          ? 1
          : final.stage_item_input2_score > final.stage_item_input1_score
            ? 2
            : final.tiebreak_winner
        : null;
    nodes.push(heading(x, lang === "he" ? "אלופת הטורניר" : "CHAMPION"));
    nodes.push(
      `<section class="diagram-champion" style="left:${x}px;top:${finalPosition.y - 55}px;width:${nodeWidth}px"><span aria-hidden="true">★</span><strong>${winner ? esc(team(final, winner)) : lang === "he" ? "הדרך לאליפות" : "ONE TEAM. ONE TITLE."}</strong><small>${winner ? (lang === "he" ? "אלופת הטורניר" : "Tournament champion") : lang === "he" ? "המנצחת בגמר תוכתר כאן" : "The final winner takes this spot."}</small></section>`,
    );
    connect(
      { x: finalPosition.x + nodeWidth, y: finalPosition.y },
      { x, y: finalPosition.y },
    );
  }
  const status = qualified
    ? lang === "he"
      ? "העולות אושרו. מנצחות במשחקים שהסתיימו עולות אוטומטית לשלב הבא."
      : "Qualifiers confirmed. Finished knockout games advance winners automatically."
    : lang === "he"
      ? `${completed}/${groupMatches.length} משחקי בתים הסתיימו · ${live} בשידור חי. העולות המוצגות זמניות ומבוססות על משחקים שהסתיימו בלבד.`
      : `${completed}/${groupMatches.length} group games finished · ${live} live. PROVISIONAL qualifiers shown from finished games only.`;
  const explanation = qualified
    ? ""
    : lang === "he"
      ? "נקודות בזמן משחק מופיעות כאן; סיום משחק בלוח החי מעדכן את הדירוג. לאחר סיום כל משחקי הבתים, המארגן מאשר את העולות."
      : "Live scores appear below. Use Finish game in Live Court to update rankings. After every group game is finished, the organizer confirms qualification.";
  return `<div class="section-head"><h2>${tr("Diagram")}</h2><div class="diagram-controls"><button id="diagram-fit">${lang === "he" ? "התאמה למסך" : "Fit"}</button><button id="diagram-full">100%</button><output id="diagram-zoom">${Math.round(diagramZoom * 100)}%</output></div></div><div class="diagram-status" role="status"><strong>${status}</strong><p>${explanation}</p>${!qualified && completed === groupMatches.length && role() === "OWNER" ? `<button id="diagram-qualify">${lang === "he" ? "אישור העולות ופתיחת הנוקאאוט" : "Confirm qualifiers & start knockout"}</button>` : ""}</div><div class="diagram-scroll" tabindex="0" aria-label="${esc(tr("Diagram"))}"><div class="diagram-sized" style="width:${width * diagramZoom}px;height:${height * diagramZoom}px"><div class="diagram-canvas" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;transform:scale(${diagramZoom})"><svg class="diagram-links" width="${width}" height="${height}" aria-hidden="true">${paths.join("")}</svg>${nodes.join("")}</div></div></div>`;
}

function bindDiagramControls() {
  const canvas = document.querySelector(".diagram-canvas");
  if (!canvas) return;
  const qualify = document.querySelector("#diagram-qualify");
  if (qualify)
    qualify.onclick = async () => {
      qualify.disabled = true;
      try {
        await api(`/live/tournaments/${tid}/qualify`, { method: "POST" });
        await load(true);
      } catch (e) {
        toast(e.message);
        qualify.disabled = false;
      }
    };
  document.querySelector("#diagram-fit").onclick = () => {
    diagramZoom = Math.max(
      0.18,
      Math.min(
        1,
        (document.querySelector(".diagram-scroll").clientWidth - 16) /
          Number(canvas.dataset.width),
      ),
    );
    render();
  };
  document.querySelector("#diagram-full").onclick = () => {
    diagramZoom = 1;
    render();
  };
}
