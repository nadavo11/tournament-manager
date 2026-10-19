const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const accounts = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../.local/demo-accounts.json"), "utf8"),
);
const evidence = [];
const record = (step, details) => {
  evidence.push({ step, passed: true, at: new Date().toISOString(), details });
  console.log("PASS:", step, JSON.stringify(details || {}));
};
async function login(page, key) {
  await page.goto("/");
  await page.locator("#title").filter({ hasText: "Community Cup" }).waitFor();
  await page.locator("#auth").click();
  await page.locator("[name=email]").fill(accounts[key].email);
  await page.locator("[name=password]").fill(accounts[key].password);
  await page.locator("#login [type=submit]").click();
  await expect(page.locator("#identity")).toContainText(
    key === "admin"
      ? "Administrator"
      : key === "scorekeeper-a"
        ? "Scorekeeper A"
        : "Scorekeeper B",
  );
}
async function request(page, url, method = "GET", body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const t = sessionStorage.getItem("bracket-token");
      let r = await fetch("/api" + url, {
        method,
        headers: {
          ...(t ? { Authorization: "Bearer " + t } : {}),
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: await r.json() };
    },
    { url, method, body },
  );
}
const flat = (s) =>
  s.stages.flatMap((s) =>
    s.stage_items.flatMap((i) => i.rounds.flatMap((r) => r.matches)),
  );
async function openEditor(page, id) {
  await page.locator("[data-tab=Matches]").click();
  await page.locator(`[data-edit="${id}"]`).click();
  await expect(page.locator("#score-form")).toBeVisible();
}
async function setEditor(page, h, a) {
  await page.getByLabel("Home score").fill(String(h));
  await page.getByLabel("Away score").fill(String(a));
  await page.locator("#score-form [name=status]").selectOption("COMPLETED");
}
async function expectScore(page, id, h, a) {
  await expect(page.locator(`[data-match="${id}"] .score-display`)).toHaveText(
    `${h} – ${a}`,
  );
}
test("four independent sessions synchronize scores, standings, conflicts, permissions and reloads", async ({
  browser,
}, testInfo) => {
  fs.mkdirSync("evidence", { recursive: true });
  let contexts = [],
    pages = [];
  try {
    for (let i = 0; i < 4; i++) {
      let c = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
        ...(i === 3
          ? {
              recordVideo: {
                dir: "evidence/video",
                size: { width: 1280, height: 900 },
              },
            }
          : {}),
      });
      contexts.push(c);
      pages.push(await c.newPage());
    }
    const [admin, a, b, viewer] = pages;
    await login(admin, "admin");
    await login(a, "scorekeeper-a");
    await login(b, "scorekeeper-b");
    await viewer.goto("/");
    await expect(viewer.locator("#identity")).toContainText("Public viewer");
    record("Four isolated browser contexts authenticated independently", {
      identities: await Promise.all(
        pages.map((p) => p.locator("#identity").innerText()),
      ),
    });
    const list = await request(admin, "/live/tournaments");
    let tid = list.data[0].id;
    expect(
      (await request(admin, `/live/tournaments/${tid}/reset`, "POST")).status,
    ).toBe(200);
    await Promise.all(
      pages.map((p) => p.locator("[data-tab=Matches]").click()),
    );
    const initial = (await request(admin, `/live/tournaments/${tid}`)).data;
    const [m1, m2] = flat(initial).filter((m) => m.live_status === "PENDING");
    const navigations = pages.map(() => 0);
    pages.forEach((p, i) =>
      p.on("framenavigated", (f) => {
        if (f === p.mainFrame()) navigations[i]++;
      }),
    );
    await openEditor(a, m1.id);
    await openEditor(b, m2.id);
    await setEditor(a, 7, 2);
    await setEditor(b, 1, 4);
    await Promise.all([
      a.locator("#score-form [type=submit]").click(),
      b.locator("#score-form [type=submit]").click(),
    ]);
    await Promise.all(
      pages.flatMap((p) => [
        expectScore(p, m1.id, 7, 2),
        expectScore(p, m2.id, 1, 4),
      ]),
    );
    expect(navigations).toEqual([0, 0, 0, 0]);
    record(
      "Simultaneous writes to different matches appear in all sessions without refresh",
      { match1: m1.id, match2: m2.id, navigations },
    );
    const current = (await request(admin, `/live/tournaments/${tid}`)).data;
    const oracle = {};
    for (const i of current.stages[0].stage_items) {
      for (const x of i.inputs)
        oracle[x.id] = { p: 0, gf: 0, ga: 0, points: 0 };
      for (const m of i.rounds
        .flatMap((r) => r.matches)
        .filter((m) => m.live_status === "COMPLETED")) {
        let x = oracle[m.stage_item_input1_id],
          y = oracle[m.stage_item_input2_id];
        x.p++;
        y.p++;
        x.gf += m.stage_item_input1_score;
        x.ga += m.stage_item_input2_score;
        y.gf += m.stage_item_input2_score;
        y.ga += m.stage_item_input1_score;
        if (m.stage_item_input1_score > m.stage_item_input2_score)
          x.points += 3;
        else if (m.stage_item_input1_score < m.stage_item_input2_score)
          y.points += 3;
        else {
          x.points++;
          y.points++;
        }
      }
    }
    for (const table of current.stages[0].stage_items.map(g=>current.standings[g.id]))
      for (const row of table) {
        expect(Number(row.points)).toBe(oracle[row.input_id].points);
        expect(row.goals_for).toBe(oracle[row.input_id].gf);
        expect(row.goals_against).toBe(oracle[row.input_id].ga);
      }
    await Promise.all(
      pages.map((p) => p.locator("[data-tab=Standings]").click()),
    );
    let expectedTables = current.stages[0].stage_items.map(g=>current.standings[g.id])
      .flat()
      .map((r) => ({
        name: r.name,
        pts: Number(r.points),
        gd: r.goals_for - r.goals_against,
      }));
    for (const p of pages)
      for (const row of expectedTables) {
        let tr = p
          .locator("#content tbody tr")
          .filter({ has: p.locator("td:nth-child(2)", { hasText: row.name }) });
        await expect(tr.locator("td:last-child")).toHaveText(String(row.pts));
        await expect(tr.locator("td:nth-last-child(2)")).toHaveText(
          (row.gd > 0 ? "+" : "") + row.gd,
        );
      }
    record(
      "Standings update in all four sessions and match an independent completed-results oracle",
      { teams: expectedTables.length },
    );
    const write = {
      version: flat(current).find((m) => m.id === m1.id).live_version,
      home: 9,
      away: 0,
      status: "COMPLETED",
    };
    expect(
      (
        await request(
          viewer,
          `/live/tournaments/${tid}/matches/${m1.id}`,
          "PUT",
          write,
        )
      ).status,
    ).toBe(401);
    expect(
      (await request(viewer, `/tournaments/${tid}/matches/${m1.id}`, "PUT", {}))
        .status,
    ).toBe(401);
    expect(
      (await request(a, `/live/tournaments/${tid}/reset`, "POST")).status,
    ).toBe(403);
    expect(
      (await request(a, `/tournaments/${tid}/matches/${m1.id}`, "PUT", {}))
        .status,
    ).toBe(403);
    expect(
      (
        await request(a, `/live/tournaments/${tid}/users`, "POST", {
          email: "forbidden@test.example",
          name: "Forbidden",
          password: "LongEnoughPassword123!",
          role: "OWNER",
        })
      ).status,
    ).toBe(403);
    record(
      "Backend rejects public viewer writes and scorekeeper administrative/legacy bypasses",
    );
    await openEditor(a, m1.id);
    await openEditor(b, m1.id);
    await setEditor(a, 8, 2);
    await setEditor(b, 6, 6);
    await a.locator("#score-form [type=submit]").click();
    await expect(a.locator("#dialog")).not.toBeVisible();
    await b.locator("#score-form [type=submit]").click();
    await expect(b.locator("#score-form .error")).toContainText(
      "Another scorekeeper",
    );
    await expect(b.locator("#latest")).toBeVisible();
    expect(
      flat((await request(admin, `/live/tournaments/${tid}`)).data).find(
        (m) => m.id === m1.id,
      ).stage_item_input1_score,
    ).toBe(8);
    await b.locator("#latest").click();
    await expect(b.getByLabel("Home score")).toHaveValue("8");
    await b.locator(".close").click();
    record(
      "Stale editor is rejected with HTTP 409 and recovers by loading the latest result",
    );
    const revision = flat(
      (await request(admin, `/live/tournaments/${tid}`)).data,
    ).find((m) => m.id === m2.id).live_version;
    let race = await Promise.all([
      request(a, `/live/tournaments/${tid}/matches/${m2.id}`, "PUT", {
        version: revision,
        home: 2,
        away: 4,
        status: "COMPLETED",
      }),
      request(b, `/live/tournaments/${tid}/matches/${m2.id}`, "PUT", {
        version: revision,
        home: 3,
        away: 4,
        status: "COMPLETED",
      }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    record(
      "Truly concurrent same-version requests produce exactly one winner",
      { statuses: race.map((r) => r.status) },
    );
    const final = (await request(admin, `/live/tournaments/${tid}`)).data;
    const finalM2 = flat(final).find((m) => m.id === m2.id);
    await Promise.all(pages.map((p) => p.reload()));
    for (const p of pages) {
      await p.locator("[data-tab=Matches]").click();
      await expectScore(p, m1.id, 8, 2);
      await expectScore(p, m2.id, finalM2.stage_item_input1_score, 4);
    }
    expect(await a.locator("#identity").innerText()).toContain("Scorekeeper A");
    expect(await b.locator("#identity").innerText()).toContain("Scorekeeper B");
    record(
      "All browser reloads preserve database results and independent sessions",
    );
    await viewer.locator("[data-tab=Groups]").click();
    await viewer.screenshot({ path: "evidence/desktop.png", fullPage: true });
    await viewer.setViewportSize({ width: 390, height: 844 });
    await viewer.screenshot({ path: "evidence/mobile.png", fullPage: true });
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await viewer.locator("#language").click();
    await expect(viewer.locator("html")).toHaveAttribute("dir", "rtl");
    await viewer.screenshot({
      path: "evidence/hebrew-mobile.png",
      fullPage: true,
    });
    record("Mobile layout fits 390px and Hebrew switch applies RTL");
  } finally {
    for (const c of contexts) await c.close();
    fs.writeFileSync(
      "evidence/multiuser-proof.json",
      JSON.stringify(
        {
          baseURL: testInfo.project.use.baseURL,
          recordedAt: new Date().toISOString(),
          checks: evidence,
        },
        null,
        2,
      ),
    );
  }
});

test("upstream fixture engine, qualification, tiebreaks, progression, corrections and reset", async ({
  browser,
}) => {
  const c = await browser.newContext();
  const page = await c.newPage();
  await login(page, "admin");
  try {
    let result = await request(page, "/live/tournaments", "POST", {
      name: "Workflow verification",
      teams: Array.from({ length: 16 }, (_, i) => "Test Team " + (i + 1)),
      groups: 4,
      qualify: 2,
      shuffle: true,
    });
    expect(result.status).toBe(200);
    const tid = result.data.id;
    expect(
      (await request(page, `/live/tournaments/${tid}/reshuffle`, "POST"))
        .status,
    ).toBe(200);
    let s = (await request(page, `/live/tournaments/${tid}`)).data;
    let matches = s.stages[0].stage_items.flatMap(g=>g.rounds.flatMap(r=>r.matches));
    expect(matches.length).toBe(24);
    for (const group of s.stages[0].stage_items) {
      let pairs = group.rounds
        .flatMap((r) => r.matches)
        .map((m) =>
          [m.stage_item_input1_id, m.stage_item_input2_id].sort().join("-"),
        );
      expect(new Set(pairs).size).toBe(6);
    }
    expect(
      (await request(page, `/live/tournaments/${tid}/qualify`, "POST")).status,
    ).toBe(409);
    for (const m of matches)
      expect(
        (
          await request(
            page,
            `/live/tournaments/${tid}/matches/${m.id}`,
            "PUT",
            { version: m.live_version, home: 2, away: 1, status: "COMPLETED" },
          )
        ).status,
      ).toBe(200);
    expect(
      (await request(page, `/live/tournaments/${tid}/reshuffle`, "POST"))
        .status,
    ).toBe(409);
    expect(
      (await request(page, `/live/tournaments/${tid}/qualify`, "POST")).status,
    ).toBe(200);
    s = (await request(page, `/live/tournaments/${tid}`)).data;
    let ko = s.stages[1].stage_items[0];
    expect(ko.rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    let qf = ko.rounds[0].matches[0];
    expect(
      (
        await request(
          page,
          `/live/tournaments/${tid}/matches/${qf.id}`,
          "PUT",
          { version: qf.live_version, home: 1, away: 1, status: "COMPLETED" },
        )
      ).status,
    ).toBe(422);
    for (let round = 0; round < 3; round++) {
      s = (await request(page, `/live/tournaments/${tid}`)).data;
      for (const m of s.stages[1].stage_items[0].rounds[round].matches) {
        expect(m.stage_item_input1_id).toBeTruthy();
        expect(m.stage_item_input2_id).toBeTruthy();
        expect(
          (
            await request(
              page,
              `/live/tournaments/${tid}/matches/${m.id}`,
              "PUT",
              {
                version: m.live_version,
                home: 1,
                away: 1,
                status: "COMPLETED",
                tiebreak_winner: 1,
              },
            )
          ).status,
        ).toBe(200);
      }
    }
    s = (await request(page, `/live/tournaments/${tid}`)).data;
    expect(flat(s).filter((m) => m.live_status === "COMPLETED").length).toBe(
      31,
    );
    const gm = flat(s)[0];
    expect(
      (
        await request(
          page,
          `/live/tournaments/${tid}/matches/${gm.id}`,
          "PUT",
          { version: gm.live_version, home: 4, away: 0, status: "COMPLETED" },
        )
      ).status,
    ).toBe(409);
    qf = s.stages[1].stage_items[0].rounds[0].matches[0];
    expect(
      (
        await request(
          page,
          `/live/tournaments/${tid}/matches/${qf.id}`,
          "PUT",
          { version: qf.live_version, home: 4, away: 0, status: "COMPLETED" },
        )
      ).status,
    ).toBe(409);
    expect(
      (await request(page, `/live/tournaments/${tid}/reset`, "POST")).status,
    ).toBe(200);
    s = (await request(page, `/live/tournaments/${tid}`)).data;
    expect(s.stages.length).toBe(2);
    expect(flat(s).length).toBe(31);
    expect(flat(s).filter((m) => m.live_status === "LIVE").length).toBe(4);
    fs.writeFileSync(
      "evidence/workflow-proof.json",
      JSON.stringify(
        {
          passed: true,
          checks: [
            "16 teams / 4 groups / 24 unique round-robin fixtures",
            "Incomplete groups cannot qualify",
            "8-team knockout seeded through Bracket",
            "Quarterfinals, semifinals and final progress automatically",
            "Tied knockout rejected without explicit winner",
            "Explicit tiebreak winners advance",
            "Group corrections locked after qualification",
            "Upstream correction blocked once later round started",
            "Reset restores 24 seeded group matches",
          ],
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await c.close();
  }
});
