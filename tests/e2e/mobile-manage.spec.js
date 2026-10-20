import { expect, test } from "@playwright/test";

const providerSpec = {
  openapi: "3.1.0",
  info: { title: "Hermes", version: "test" },
  paths: {
    "/api/providers/custom-endpoints": {
      post: {
        summary: "Add provider",
        tags: ["providers"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["provider_id", "base_url", "access"],
                properties: {
                  provider_id: { type: "string" },
                  base_url: { type: "string", format: "uri" },
                  access: { type: "string", title: "Client Secret" },
                  api_mode: { type: "string", enum: ["openai", "anthropic"] }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Provider added" } }
      }
    }
  }
};

async function mockManageBackend(page) {
  await page.route("**/hermes/**", route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === "/hermes/openapi.json") body = providerSpec;
    else if (path.endsWith("/cli-operations")) body = { operations: [], counts: {} };
    else if (path.endsWith("/api/health")) body = { status: "ok", version: "test" };
    else if (path.endsWith("/api/profiles/active")) body = { active: "default", current: "default" };
    else if (path.endsWith("/api/profiles")) body = { profiles: [{ name: "default" }] };
    else if (path.endsWith("/config/schema")) body = { fields: {} };
    else if (path.endsWith("/config/defaults")) body = {};
    else if (path.endsWith("/config")) body = {};
    else if (path.endsWith("/skills") || path.endsWith("/skills/hub/official")) body = { skills: [] };
    else if (path.endsWith("/model-menu")) body = { providers: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("mobile Manage is compact and generated actions are friendly", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile ergonomics only");
  await mockManageBackend(page);
  await page.goto("/runtime-config-settings.html?tab=controls#api%3APOST%3A%2Fapi%2Fproviders%2Fcustom-endpoints");

  await expect(page.locator("#panel-controls")).toBeVisible();
  await expect(page.locator("#controlForm")).toBeVisible();
  await expect(page.locator(".bc-common-card")).toHaveCount(1);

  const mobileLayout = await page.evaluate(() => {
    const heading = document.querySelector(".workspace-heading").getBoundingClientRect();
    const profile = document.querySelector(".profile-switcher").getBoundingClientRect();
    const common = document.querySelector(".bc-common-grid");
    const actionBar = document.querySelector(".bc-form-actions");
    return {
      headingHeight: heading.height,
      profileHeight: profile.height,
      commonDisplay: getComputedStyle(common).display,
      commonFits: common.scrollWidth <= common.clientWidth + 1,
      actionPosition: getComputedStyle(actionBar).position,
      actionBottom: getComputedStyle(actionBar).bottom,
      liveBadgeDisplay: getComputedStyle(document.querySelector("#demo-notice")).display
    };
  });
  expect(mobileLayout.headingHeight).toBeLessThan(70);
  expect(mobileLayout.profileHeight).toBeLessThan(100);
  expect(mobileLayout.commonDisplay).toBe("grid");
  expect(mobileLayout.commonFits).toBe(true);
  expect(mobileLayout.actionPosition).toBe("sticky");
  expect(Number.parseFloat(mobileLayout.actionBottom)).toBeGreaterThanOrEqual(64);
  expect(mobileLayout.liveBadgeDisplay).toBe("none");

  await expect(page.getByLabel(/^Provider ID/)).toBeVisible();
  await expect(page.getByLabel(/^Base URL/)).toBeVisible();
  await expect(page.getByText("Web address", { exact: true })).toBeVisible();
  await expect(page.getByText("The service address Hermes should connect to.")).toBeVisible();
  await expect(page.getByText("Private value", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cockpit masks the value on screen/)).toBeVisible();
  await expect(page.locator('input[name="access"]')).toHaveAttribute("type", "password");
  await expect(page.locator('input[name="access"]')).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByRole("link", { name: "Open provider setup" })).toHaveAttribute("href", "models-providers.html#add-provider");

  await page.locator("#workspace-tab-settings").click();
  await expect(page.locator("#panel-settings")).toBeVisible();
  await expect(page.locator(".settings-toolbar")).toHaveCSS("position", "sticky");
  await expect(page.locator(".profile-primary-actions")).toBeHidden();
});
