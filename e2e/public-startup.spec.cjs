const { test, expect } = require("@playwright/test");

const teams = [
  { id: 1, name: "Hawks" },
  { id: 2, name: "Foxes" },
];
const match = {
  id: 11,
  live_version: 1,
  live_status: "LIVE",
  stage_item_input1: { id: 1, team: teams[0] },
  stage_item_input2: { id: 2, team: teams[1] },
  stage_item_input1_score: 3,
  stage_item_input2_score: 2,
};
const snapshot = (id = 1) => ({
  tournament: {
    id,
    club_id: 1,
    name: `Public Cup ${id}`,
    revision: 1,
    qualify: 2,
  },
  stages: [
    {
      stage_items: [
        {
          id: 1,
          name: "Group A",
          type: "ROUND_ROBIN",
          team_count: 2,
          rounds: [{ name: "Round 1", matches: [match] }],
        },
      ],
    },
    {
      stage_items: [
        {
          id: 2,
          name: "Final",
          type: "SINGLE_ELIMINATION",
          team_count: 2,
          rounds: [
            {
              name: "Final",
              matches: [{ ...match, id: 12, live_status: "PENDING" }],
            },
          ],
        },
      ],
    },
  ],
  standings: {
    1: teams.map((t) => ({
      ...t,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      points: 0,
    })),
  },
  audit: [],
});
const profile = {
  name: "Organizer",
  memberships: [{ club_id: 1, relation: "OWNER" }],
};
const court = {
  version: 1,
  match: {
    id: 11,
    home: "Hawks",
    away: "Foxes",
    home_team_id: 1,
    away_team_id: 2,
    home_score: 3,
    away_score: 2,
    status: "LIVE",
  },
  game: { profile: "standard", period: 1, period_count: 4 },
  clock: { remaining_ms: 600000, running: false },
  roster: [{ id: 1, team_id: 1, name: "Player One", jersey: "7" }],
  box: {
    teams: {
      1: { fouls_period: 0, timeouts: 0, unassigned_points: 3 },
      2: { fouls_period: 0, timeouts: 0, unassigned_points: 2 },
    },
    players: {
      1: {
        pts: 3,
        oreb: 0,
        dreb: 0,
        ast: 0,
        pf: 0,
        on_court: null,
        fgm: 1,
        fga: 1,
        tpm: 1,
        tpa: 1,
        ftm: 0,
        fta: 0,
        stl: 0,
        blk: 0,
        to: 0,
      },
    },
  },
  events: [],
};
const json = (route, data, status = 200) =>
  route.fulfill({ status, json: data });
async function mockPublic(page) {
  await page.route("**/api/live/tournaments", (route) =>
    json(route, [
      { id: 1, name: "Public Cup 1" },
      { id: 2, name: "Public Cup 2" },
    ]),
  );
  await page.route(/\/api\/live\/tournaments\/\d+(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    return json(
      route,
      url.searchParams.has("since")
        ? { unchanged: true }
        : snapshot(Number(url.pathname.split("/").at(-1))),
    );
  });
  await page.route("**/basketball/matches/*", (route) => json(route, court));
}
async function submitLogin(page) {
  await page.locator("#auth").click();
  await page.locator('[name="email"]').fill("organizer");
  await page.locator('[name="password"]').fill("test-only-password");
  await page.locator("#login [type=submit]").click();
}

test("guests can browse every view and player stats without write controls", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r);
  });
  await mockPublic(page);
  await page.goto("/?t=1");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  for (const tab of [
    "Groups",
    "Matches",
    "Standings",
    "Knockout",
    "Diagram",
    "Live Court",
  ]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator("#content")).toContainText(
      tab === "Live Court"
        ? "Hawks"
        : tab === "Diagram"
          ? "CHAMPION"
          : tab === "Knockout"
            ? "FINAL"
            : "Hawks",
    );
    await expect(
      page.locator("[data-edit], [data-court-action], [data-court-control]"),
    ).toHaveCount(0);
  }
  await page.locator('[data-court-mode="players"]').click();
  await expect(page.locator("#content")).toContainText("Player One");
  await expect(page.locator("#admin")).toBeHidden();
  await expect(page.locator("#new")).toBeHidden();
  expect(
    requests.every((r) => r.method() === "GET" && !r.headers().authorization),
  ).toBe(true);
});

test("a slow saved session never delays anonymous data or adds auth to public reads", async ({
  page,
}) => {
  await mockPublic(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("bracket-token", "old-session"),
  );
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live/me", async (route) => {
    await held;
    await json(route, { detail: "Expired" }, 401);
  });
  const reads = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/live/tournaments")) reads.push(r);
  });
  await page.goto("/?t=1");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  await expect(page.locator("#identity")).toContainText("Public viewer");
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((r) => !r.headers().authorization)).toBe(true);
  release();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("bracket-token")))
    .toBeNull();
});

test("startup retries a sleeping server's non-JSON response without reloading", async ({
  page,
}) => {
  await mockPublic(page);
  let attempts = 0;
  await page.route("**/api/live/tournaments", (route) =>
    ++attempts === 1
      ? route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "Waking up",
        })
      : json(route, [{ id: 1, name: "Public Cup 1" }]),
  );
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Offline · retrying");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  expect(attempts).toBeGreaterThan(1);
});

test("login renders permissions immediately without waiting for a tournament refresh", async ({
  page,
}) => {
  await mockPublic(page);
  await page.route("**/api/token", (route) =>
    json(route, { access_token: "new-session" }),
  );
  await page.route("**/api/live/me", (route) => json(route, profile));
  await page.goto("/?t=1");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  // A slow in-flight poll must not hold the login dialog open.
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/live\/tournaments\/1(\?.*)?$/, async (route) => {
    await held;
    await json(route, { unchanged: true });
  });
  await submitLogin(page);
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(page.locator("#identity")).toHaveText("Organizer · Organizer");
  await expect(page.locator("#admin")).toBeVisible();
  await page.locator("#auth").click();
  await expect(page.locator("#identity")).toContainText("Public viewer");
  await expect(page.locator("#admin")).toBeHidden();
  release();
});

test("slow login explains server wake-up and invalid credentials remain retryable", async ({
  page,
}) => {
  await mockPublic(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/token", async (route) => {
    await held;
    await json(route, { detail: "Incorrect email or password" }, 401);
  });
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  await submitLogin(page);
  await expect(page.locator("#login button")).toHaveText("Signing in…");
  await expect(page.locator(".login-status")).toContainText("about a minute");
  release();
  await expect(page.locator("#login .error")).toHaveText(
    "Incorrect email or password",
  );
  await expect(page.locator("#login button")).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("bracket-token")),
  ).toBeNull();
});

test("Live Court share parameters survive startup and reload", async ({
  page,
}) => {
  await mockPublic(page);
  await page.goto("/?t=1&view=live&match=11");
  await expect(page.locator("#court-board")).toBeVisible();
  await expect(page).toHaveURL(/view=live&match=11/);
  await page.reload();
  await expect(page.locator("#court-board")).toBeVisible();
});

test("a late response for an old tournament cannot overwrite the selected tournament", async ({
  page,
}) => {
  await mockPublic(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live/tournaments/1", async (route) => {
    await held;
    await json(route, snapshot(1));
  });
  await page.goto("/?t=1");
  await expect(page.locator("#tournaments option")).toHaveCount(2);
  await page.locator("#tournaments").selectOption("2");
  release();
  await expect(page.locator("#title")).toHaveText("Public Cup 2");
  await expect(page.locator("#tournaments")).toHaveValue("2");
});

test("empty public list has a clear viewer state", async ({ page }) => {
  await mockPublic(page);
  await page.route("**/api/live/tournaments", (route) => json(route, []));
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("No public tournaments");
  await expect(page.locator("#content")).toContainText(
    "No public tournaments are available yet",
  );
  expect(page.url()).not.toContain("undefined");
});

test("an unresponsive first request times out and recovers automatically", async ({
  page,
}) => {
  await page.clock.install();
  await mockPublic(page);
  let attempts = 0;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live/tournaments", async (route) => {
    if (++attempts === 1) await held;
    await json(route, [{ id: 1, name: "Public Cup 1" }]);
  });
  await page.goto("/");
  await expect.poll(() => attempts).toBe(1);
  await page.clock.fastForward(16000);
  await expect(page.locator("#connection")).toHaveText("Offline · retrying");
  await page.clock.fastForward(2000);
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  release();
});

test("late expired-session response cannot undo a fresh login", async ({
  page,
}) => {
  await mockPublic(page);
  await page.addInitScript(() =>
    sessionStorage.setItem("bracket-token", "old-session"),
  );
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live/me", async (route) => {
    if (route.request().headers().authorization === "Bearer old-session") {
      await held;
      await json(route, { detail: "Expired" }, 401);
    } else await json(route, profile);
  });
  await page.route("**/api/token", (route) =>
    json(route, { access_token: "new-session" }),
  );
  await page.goto("/");
  await expect(page.locator("#title")).toHaveText("Public Cup 1");
  await submitLogin(page);
  await expect(page.locator("#identity")).toHaveText("Organizer · Organizer");
  const expired = page.waitForResponse(
    (response) =>
      response.url().endsWith("/live/me") && response.status() === 401,
  );
  release();
  await expired;
  await expect(page.locator("#identity")).toHaveText("Organizer · Organizer");
  expect(
    await page.evaluate(() => sessionStorage.getItem("bracket-token")),
  ).toBe("new-session");
});
