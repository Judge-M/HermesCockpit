import { expect, test } from "@playwright/test";

const screens = [
  "live-control",
  "bot-mode",
  "kanban",
  "models-providers",
  "mesh-topology",
  "tool-registry",
  "acp-telemetry",
  "runtime-config-settings",
  "backend-control",
  "cli-control"
];

const navigation = [
  "live-control",
  "bot-mode",
  "kanban",
  "models-providers",
  "tool-registry",
  "mesh-topology",
  "runtime-config-settings",
  "acp-telemetry"
];

async function makeBackendUnavailable(page) {
  const unavailable = route => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ detail: "Hermes backend unavailable in static verification" })
  });
  await page.route("**/hermes/**", unavailable);
  await page.route("**/api/**", unavailable);
}

test.beforeEach(async ({ page }) => {
  await makeBackendUnavailable(page);
});

test("shared navigation is complete and changes screens", async ({ page }, testInfo) => {
  await page.goto("/live-control.html");
  await expect(page.locator(".hc-brand")).toBeVisible();

  const destinations = await page.locator("a[data-path]").evaluateAll(links =>
    [...new Set(links.map(link => link.dataset.path))].sort()
  );
  expect(destinations).toEqual([...navigation].sort());
  await expect(page.locator('a[data-path="live-control"][aria-current="page"]')).toHaveCount(2);

  if (testInfo.project.name.includes("mobile")) {
    await expect(page.locator(".hc-mobile-nav")).toBeVisible();
    await page.locator("#hc-more-button").click();
    await expect(page.locator("#hc-more-sheet")).toBeVisible();
    await page.locator('#hc-more-sheet a[data-path="models-providers"]').click();
  } else {
    await expect(page.locator(".hc-sidebar")).toBeVisible();
    await page.locator('.hc-sidebar a[data-path="models-providers"]').click();
  }

  await expect(page).toHaveURL(/\/models-providers\.html(?:\?|$)/);
  await expect(page.locator('a[data-path="models-providers"][aria-current="page"]')).toHaveCount(2);
});

for (const screen of screens) {
  test(`${screen} loads its local assets and responsive shell`, async ({ page }, testInfo) => {
    const broken = [];
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin !== "http://127.0.0.1:4174") return;
      if (url.pathname.startsWith("/hermes/") || url.pathname.startsWith("/api/")) return;
      if (response.status() >= 400) broken.push(`${response.status()} ${url.pathname}`);
    });

    await page.goto(`/${screen}.html`, { waitUntil: "load" });
    await expect(page.locator("#shared-header .hc-header")).toBeVisible();
    await expect(page.locator('main[data-workspace="true"]')).toBeVisible();
    await expect(page.locator(`a[data-path="${screen}"][aria-current="page"]`)).toHaveCount(
      navigation.includes(screen) ? 2 : 0
    );

    const mobile = testInfo.project.name.includes("mobile");
    if (mobile) {
      await expect(page.locator(".hc-sidebar")).toBeHidden();
      await expect(page.locator(".hc-mobile-nav")).toBeVisible();
    } else {
      await expect(page.locator(".hc-sidebar")).toBeVisible();
      await expect(page.locator(".hc-mobile-nav")).toBeHidden();
    }

    const geometry = await page.evaluate(() => {
      const header = document.querySelector(".hc-header").getBoundingClientRect();
      const workspace = document.querySelector('main[data-workspace="true"]').getBoundingClientRect();
      return {
        headerLeft: header.left,
        headerRight: header.right,
        viewportWidth: window.innerWidth,
        contentTop: workspace.top + Number.parseFloat(getComputedStyle(document.querySelector('main[data-workspace="true"]')).paddingTop)
      };
    });
    expect(geometry.headerLeft).toBeGreaterThanOrEqual(-1);
    expect(geometry.headerRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.contentTop).toBeGreaterThanOrEqual(50);
    expect(broken, `Broken local responses on ${screen}`).toEqual([]);
  });
}

test("backend outage is explicit and never produces fake workspace data", async ({ page }) => {
  await page.goto("/kanban.html");
  await expect(page.locator("#unavailableState")).toBeVisible();
  await expect(page.locator("#unavailableCopy")).toContainText("Hermes could not load");
  await expect(page.locator("#board")).toBeHidden();
  await expect(page.locator(".kb-column")).toHaveCount(0);

  await page.goto("/mesh-topology.html");
  await expect(page.locator("#system-connection")).toContainText("Hermes unavailable");
  await expect(page.getByText(/Profiles unavailable:/)).toBeVisible();

  await page.goto("/live-control.html");
  await expect(page.locator("#cockpit-sessions")).toContainText("Sessions unavailable");
  await expect(page.locator("#cockpit-bot-transcript .cockpit-message")).toHaveCount(0);
});
