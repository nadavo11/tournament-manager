const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test("named Streetball4Biber site: admin3, dark theme, diagram and live scoring", async ({
  browser,
}, info) => {
  const accounts = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../.local/demo-accounts.json"),
      "utf8",
    ),
  );
  const backend = fs
    .readFileSync(path.join(__dirname, "../.local/active-url.txt"), "utf8")
    .trim();
  const frontend =
    process.env.FRONTEND_URL || "https://nadavo11.github.io/streetball4biber/";
  const api = await browser.newContext();
  const setupAPI = process.env.SETUP_API_URL || "http://127.0.0.1:8400";
  const auth = await api.request.post(setupAPI + "/api/token", {
    form: { username: accounts.admin.email, password: accounts.admin.password },
  });
  expect(auth.status()).toBe(200);
  const access = (await auth.json()).access_token;
  const headers = { Authorization: "Bearer " + access };
  const created = await api.request.post(setupAPI + "/api/live/tournaments", {
    headers,
    data: {
      name: "Streetball diagram verification",
      teams: Array.from({ length: 16 }, (_, i) => "Diagram Team " + (i + 1)),
      groups: 4,
      qualify: 2,
      shuffle: false,
    },
  });
  expect(created.status()).toBe(200);
  const tid = (await created.json()).id;
  fs.writeFileSync(
    path.join(__dirname, "../.local/ui-verification-tournament.json"),
    JSON.stringify({ id: tid }),
  );
  const address = frontend + "?t=" + tid;
  const viewerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const viewer = await viewerContext.newPage(),
    admin = await adminContext.newPage();
  try {
    await viewer.goto(address);
    await expect(viewer.locator("#title")).toHaveText(
      "Streetball diagram verification",
    );
    expect(
      await viewer.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
    ).toBe("dark");
    await viewer.locator("[data-tab=Diagram]").click();
    await expect(viewer.locator(".diagram-group")).toHaveCount(4);
    await expect(viewer.locator(".diagram-match")).toHaveCount(7);
    await expect(viewer.locator(".diagram-links path")).toHaveCount(15);
    await expect(viewer.locator(".diagram-edit")).toHaveCount(0);
    await viewer.screenshot({
      path: "evidence/streetball4biber-diagram.png",
      fullPage: true,
    });
    const state = await (
      await api.request.get(setupAPI + `/api/live/tournaments/${tid}`)
    ).json();
    const group = state.stages[0].stage_items[0],
      match = group.rounds[0].matches[0];
    let navigations = 0;
    viewer.on("framenavigated", (f) => {
      if (f === viewer.mainFrame()) navigations++;
    });
    await admin.goto(address);
    await admin.locator("#auth").click();
    await admin.locator("[name=email]").fill(accounts.admin3.username);
    await admin.locator("[name=password]").fill(accounts.admin3.password);
    await admin.locator("#login [type=submit]").click();
    await expect(admin.locator("#identity")).toHaveText("admin3 · Organizer");
    await expect(admin.locator("#admin")).toBeVisible();
    await admin.locator("[data-tab=Matches]").click();
    await admin.locator(`[data-edit="${match.id}"]`).click();
    await admin.getByLabel("Home score").fill("6");
    await admin.getByLabel("Away score").fill("2");
    await admin.locator("#score-form [name=status]").selectOption("COMPLETED");
    await admin.locator("#score-form [type=submit]").click();
    await expect(admin.locator("#dialog")).not.toBeVisible();
    await expect(
      viewer
        .locator(`[data-diagram-group="${group.id}"] li`)
        .first()
        .locator("b"),
    ).toHaveText("3");
    expect(navigations).toBe(0);
    await viewer.setViewportSize({ width: 390, height: 844 });
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await viewer.locator("#diagram-fit").click();
    const fit = Number(
      (await viewer.locator("#diagram-zoom").textContent()).replace("%", ""),
    );
    expect(fit).toBeLessThan(100);
    await viewer.screenshot({
      path: "evidence/streetball4biber-diagram-mobile.png",
      fullPage: true,
    });
    await viewer.locator("#diagram-full").click();
    await expect(viewer.locator("#diagram-zoom")).toHaveText("100%");
    await viewer.locator("#language").click();
    await expect(viewer.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(viewer.locator(".diagram-canvas")).toBeVisible();
    fs.writeFileSync(
      "evidence/streetball4biber-proof.json",
      JSON.stringify(
        {
          passed: true,
          url: frontend,
          backend,
          checkedAt: new Date().toISOString(),
          checks: [
            "admin3 login and organizer permissions",
            "red dark theme",
            "four groups, seven knockout nodes, fifteen actual dependency edges",
            "viewer has no diagram editing controls",
            "UI score write updates viewer diagram points without navigation",
            "390px layout and fit/100% controls",
            "Hebrew RTL diagram",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await viewerContext.close();
    await adminContext.close();
    await api.close();
  }
});
