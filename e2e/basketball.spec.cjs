const { test, expect } = require("@playwright/test");
const fs = require("fs");
const { randomUUID } = require("crypto");

test("Live Court: concurrent/idempotent scoring, player stats, undo, clock and independent viewer", async ({
  browser,
}) => {
  const accounts = JSON.parse(
    fs.readFileSync("../.local/demo-accounts.json", "utf8"),
  );
  const base = "http://127.0.0.1:8400";
  const frontend = process.env.FRONTEND_URL || base + "/";
  const context = await browser.newContext();
  const request = context.request;
  const login = async (account) => {
    const r = await request.post(base + "/api/token", {
      form: {
        username: account.email || account.username,
        password: account.password,
      },
    });
    expect(r.status(), await r.text()).toBe(200);
    return { Authorization: "Bearer " + (await r.json()).access_token };
  };
  const headers = await login(accounts.admin);
  const second = await login(accounts["scorekeeper-b"]);
  const created = await request.post(base + "/api/live/tournaments", {
    headers,
    data: {
      name: "Basketball Live Court verification",
      teams: ["Red A", "Red B", "Red C", "Red D"],
      groups: 2,
      qualify: 2,
      shuffle: false,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  const tid = (await created.json()).id;
  const fixturesFile = "../.local/basketball-test-tournaments.json";
  const fixtures = fs.existsSync(fixturesFile)
    ? JSON.parse(fs.readFileSync(fixturesFile))
    : [];
  fixtures.push(tid);
  fs.writeFileSync(fixturesFile, JSON.stringify(fixtures));
  const state = await (
    await request.get(base + `/api/live/tournaments/${tid}`)
  ).json();
  const mid = state.stages[0].stage_items[0].rounds[0].matches[0].id;
  const root = base + `/api/live/tournaments/${tid}/basketball/matches/${mid}`;
  const snapshot = async () => await (await request.get(root)).json();
  const body = (kind, extra = {}) => ({
    request_id: randomUUID(),
    kind,
    side: 1,
    profile: "standard",
    ...extra,
  });
  const post = async (data, auth = headers, code = 200) => {
    const r = await request.post(root + "/plays", { headers: auth, data });
    expect(r.status(), await r.text()).toBe(code);
    return r;
  };
  const control = async (kind, extra = {}) =>
    post(
      body(kind, { side: null, version: (await snapshot()).version, ...extra }),
    );
  // Viewer access is read-only; two real scorekeepers add relative baskets concurrently.
  await post(body("two_made"), {}, 401);
  const two = body("two_made"),
    three = body("three_made");
  await Promise.all([post(two), post(three, second)]);
  expect((await snapshot()).match.home_score).toBe(5);
  await post(two);
  expect((await snapshot()).match.home_score).toBe(5);
  await post({ ...two, kind: "three_made" }, headers, 409);
  await post(body("clock_start", { side: null, version: 0 }), headers, 409);
  let s = await snapshot();
  const old = await request.put(
    base + `/api/live/tournaments/${tid}/matches/${mid}`,
    {
      headers,
      data: { version: s.version, home: 99, away: 0, status: "LIVE" },
    },
  );
  expect(old.status()).toBe(409);
  expect(
    (
      await request.put(base + `/api/live/tournaments/${tid}/matches/${mid}`, {
        headers,
        data: { version: s.version, home: 5, away: 0, status: "COMPLETED" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(
        base +
          `/api/live/tournaments/${tid}/basketball/teams/${s.match.home_team_id}/players`,
        {
          headers: second,
          data: { players: [{ name: "Unauthorized addition" }] },
        },
      )
    ).status(),
  ).toBe(403);
  const roster = await request.post(
    base +
      `/api/live/tournaments/${tid}/basketball/teams/${s.match.home_team_id}/players`,
    {
      headers,
      data: {
        players: [
          { name: "Alex", jersey: "7" },
          { name: "Maya", jersey: "12" },
        ],
      },
    },
  );
  expect(roster.status(), await roster.text()).toBe(200);
  const player = (await roster.json()).ids[0];
  await post(body("two_made", { side: 2, player_id: player }), headers, 422);
  await post(body("two_made", { player_id: player }));
  await post(body("two_missed", { player_id: player }));
  await post(body("assist", { player_id: player }));
  await post(body("defensive_rebound", { player_id: player }));
  s = await snapshot();
  expect(s.box.players[player]).toMatchObject({
    pts: 2,
    fgm: 1,
    fga: 2,
    ast: 1,
    dreb: 1,
  });
  expect(s.box.teams["1"].unassigned_points).toBe(5);
  const scored = s.events.find(
    (e) => e.kind === "two_made" && e.player_id === player,
  );
  const undo = { request_id: randomUUID(), version: s.version };
  const undone = await request.post(root + `/plays/${scored.id}/undo`, {
    headers,
    data: undo,
  });
  expect(undone.status(), await undone.text()).toBe(200);
  expect(
    (
      await request.post(root + `/plays/${scored.id}/undo`, {
        headers,
        data: undo,
      })
    ).status(),
  ).toBe(200);
  s = await snapshot();
  expect(s.match.home_score).toBe(5);
  expect(s.box.players[player]).toMatchObject({
    pts: 0,
    fgm: 0,
    fga: 1,
    ast: 1,
    dreb: 1,
  });
  await control("set_clock", { seconds: 1 });
  await control("clock_start");
  await expect.poll(async () => (await snapshot()).clock.remaining_ms).toBe(0);
  await control("clock_pause");
  await post(
    body("clock_start", { side: null, version: (await snapshot()).version }),
    headers,
    409,
  );
  await control("set_clock", { seconds: 120 });
  await control("finish");
  await post(body("two_made"), headers, 409);
  await control("resume");

  // Streetball format is chosen before play; 1/2-point baskets are distinct from free throws.
  const otherMid = state.stages[0].stage_items[1].rounds[0].matches[0].id;
  const otherRoot =
    base + `/api/live/tournaments/${tid}/basketball/matches/${otherMid}`;
  let other = await (await request.get(otherRoot)).json();
  const configure = await request.post(otherRoot + "/plays", {
    headers,
    data: body("profile", {
      side: null,
      profile: "streetball",
      version: other.version,
      period_count: 1,
      period_seconds: 600,
    }),
  });
  expect(configure.status(), await configure.text()).toBe(200);
  for (const [kind, code] of [
    ["one_made", 200],
    ["two_made", 200],
    ["free_throw_made", 200],
    ["three_made", 422],
  ]) {
    const r = await request.post(otherRoot + "/plays", {
      headers,
      data: body(kind, { profile: "streetball" }),
    });
    expect(r.status(), await r.text()).toBe(code);
  }
  other = await (await request.get(otherRoot)).json();
  expect(other.match.home_score).toBe(4);
  expect(other.box.teams["1"]).toMatchObject({
    fgm: 2,
    fga: 2,
    ftm: 1,
    fta: 1,
  });

  const viewerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const scorerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const viewer = await viewerContext.newPage(),
    scorer = await scorerContext.newPage();
  const errors = [];
  scorer.on("pageerror", (e) => errors.push(e.message));
  viewer.on("pageerror", (e) => errors.push(e.message));
  try {
    const url = frontend + `?t=${tid}&match=${mid}`;
    await Promise.all([viewer.goto(url), scorer.goto(url)]);
    await scorer.locator("#auth").click();
    await scorer.locator("[name=email]").fill(accounts.admin3.username);
    await scorer.locator("[name=password]").fill(accounts.admin3.password);
    await scorer.locator("#login [type=submit]").click();
    await expect(scorer.locator("#identity")).toContainText("admin3");
    await Promise.all([
      viewer.locator('[data-tab="Live Court"]').click(),
      scorer.locator('[data-tab="Live Court"]').click(),
    ]);
    await expect(viewer.locator('[data-court-score="1"]')).toHaveText("5");
    await expect(viewer.locator("[data-court-action]")).toHaveCount(0);
    let navigations = 0;
    viewer.on("framenavigated", (f) => {
      if (f === viewer.mainFrame()) navigations++;
    });
    await scorer
      .locator('[data-court-action="two_made"][data-side="1"]')
      .click();
    await expect(viewer.locator('[data-court-score="1"]')).toHaveText("7");
    await expect(scorer.locator(".court-sync")).toContainText("saved scores");
    // A lost response is retried with the same UUID, without adding a second basket.
    let drop = true;
    await scorer.route("**/basketball/matches/*/plays", async (route) => {
      if (drop) {
        drop = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await scorer
      .locator('[data-court-action="three_made"][data-side="2"]')
      .click();
    await expect(viewer.locator('[data-court-score="2"]')).toHaveText("3");
    await expect(scorer.locator(".court-sync")).toContainText("saved scores");
    expect((await snapshot()).match.away_score).toBe(3);
    await scorer.locator("[data-court-mode=players]").click();
    await scorer.locator(`[data-court-player="${player}"]`).click();
    await scorer
      .locator(
        '#court-recording [data-court-action="free_throw_made"][data-side="1"]',
      )
      .click();
    await expect(viewer.locator('[data-court-score="1"]')).toHaveText("8");
    await expect(
      scorer.locator(`[data-court-player="${player}"] .court-player-numbers`),
    ).toContainText("1PTS");
    await expect(scorer.locator("#court-undo-last")).toBeEnabled();
    await scorer.locator("#court-undo-last").click();
    await expect(viewer.locator('[data-court-score="1"]')).toHaveText("7");
    await scorer.screenshot({
      path: "evidence/basketball-player-stats.png",
      fullPage: true,
    });
    await scorer.locator("[data-court-mode=quick]").click();
    await scorer.screenshot({
      path: "evidence/basketball-quick-score.png",
      fullPage: true,
    });
    await scorer.setViewportSize({ width: 390, height: 844 });
    expect(
      await scorer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await scorer.screenshot({
      path: "evidence/basketball-mobile.png",
      fullPage: true,
    });
    await scorer.locator("[data-court-mode=players]").click();
    expect(
      await scorer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(navigations).toBe(0);
    expect(errors).toEqual([]);
    fs.writeFileSync(
      "evidence/basketball-proof.json",
      JSON.stringify(
        {
          passed: true,
          url: frontend,
          checkedAt: new Date().toISOString(),
          tournament: tid,
          checks: [
            "concurrent relative scoring",
            "idempotent lost-response retry",
            "read-only viewer sync without navigation",
            "wrong-team player rejection",
            "player totals, attempts, rebounds, assists and undo",
            "stale control conflict",
            "expired clock remains stopped",
            "final game protection and reopen",
            "streetball 1/2 scoring with separate free throws",
            "organizer-only roster edits and legacy editor protection",
            "390px quick and player layouts",
            "no JavaScript errors",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await viewerContext.close();
    await scorerContext.close();
    await context.close();
  }
});
