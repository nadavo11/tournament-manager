// A view of Bracket's persisted stages and match dependencies, never a second engine.
let diagramZoom = null;

function renderDiagram() {
  const groups = allItems().filter((i) => i.type === "ROUND_ROBIN");
  const knockout = allItems().find((i) => i.type === "SINGLE_ELIMINATION");
  if (!knockout)
    return `<div class="empty">${lang === "he" ? "תרשים הנוקאאוט יופיע לאחר הגדרת שלב הגמר." : "Set up the knockout stage to see its tournament diagram."}</div>`;
  const rounds = knockout.rounds;
  const pitch = 278,
    nodeWidth = 220,
    top = 72;
  const areaHeight = Math.max(
    groups.length * 168,
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
  groups.forEach((group, index) => {
    const center = top + index * 168 + 84;
    groupPositions.set(group.id, { x: 22 + nodeWidth, y: center });
    const standings = state.standings[group.id] || [];
    nodes.push(
      `<section class="diagram-group" data-diagram-group="${group.id}" style="left:22px;top:${center - 66}px;width:${nodeWidth}px"><button class="diagram-group-title" data-group="${group.id}">${esc(group.name)} <span>↗</span></button><ol>${standings.map((team, rank) => `<li class="${rank < state.tournament.qualify ? "advancing" : ""}"><span class="diagram-rank">${rank + 1}</span><span>${esc(team.name)}</span><b>${Number(team.points)}</b></li>`).join("")}</ol></section>`,
    );
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
      const row = (side) =>
        `<div class="diagram-team ${winner === side ? "winner" : ""}"><span>${esc(team(match, side))}</span><b>${match.live_status === "PENDING" ? "–" : match[`stage_item_input${side}_score`]}</b></div>`;
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
  return `<div class="section-head"><h2>${tr("Diagram")}</h2><div class="diagram-controls"><button id="diagram-fit">${lang === "he" ? "התאמה למסך" : "Fit"}</button><button id="diagram-full">100%</button><output id="diagram-zoom">${Math.round(diagramZoom * 100)}%</output></div></div><p class="muted diagram-help">${lang === "he" ? "הבתים, העולות ושלבי הגמר — כל התוצאות מתעדכנות אוטומטית. אפשר לגלול לצדדים." : "Groups → qualifiers → knockout → champion. Results update live. Scroll sideways to follow the bracket."}</p><div class="diagram-scroll" tabindex="0" aria-label="${esc(tr("Diagram"))}"><div class="diagram-sized" style="width:${width * diagramZoom}px;height:${height * diagramZoom}px"><div class="diagram-canvas" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;transform:scale(${diagramZoom})"><svg class="diagram-links" width="${width}" height="${height}" aria-hidden="true">${paths.join("")}</svg>${nodes.join("")}</div></div></div>`;
}

function bindDiagramControls() {
  const canvas = document.querySelector(".diagram-canvas");
  if (!canvas) return;
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
