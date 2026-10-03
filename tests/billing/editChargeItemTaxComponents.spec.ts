import { expect, test } from "@playwright/test";
import { getAccountId } from "tests/support/accountId";
import { getFacilityId } from "tests/support/facilityId";

const CHARGE_ITEM_TITLE = "Fasting Blood Glucose Test (tax regression)";

// Tax components exactly as the backend emits them for fixture-seeded
// definitions (care/fixtures/constants.py): `factor` is a JSON number.
const taxComponents = [
  {
    code: {
      code: "igst",
      system: "http://ohc.network/codes/monetary/tax",
      display: "IGST",
    },
    factor: 6.0,
    monetary_component_type: "tax",
  },
  {
    code: {
      code: "gst",
      system: "http://ohc.network/codes/monetary/tax",
      display: "GST",
    },
    factor: 6.0,
    monetary_component_type: "tax",
  },
];

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "care-admin",
  first_name: "Care",
  last_name: "Admin",
  prefix: null,
  suffix: null,
  user_type: "doctor",
  gender: "male",
  last_login: "2026-01-01T00:00:00Z",
  profile_picture_url: "",
  mfa_enabled: false,
  deleted: false,
  is_service_account: false,
};

function buildChargeItem(accountId: string) {
  return {
    id: "00000000-0000-4000-8000-00000000c0de",
    title: CHARGE_ITEM_TITLE,
    description: "",
    status: "billable",
    quantity: "1.000000",
    unit_price_components: [
      { amount: 600.0, monetary_component_type: "base" },
      ...taxComponents,
    ],
    total_price_components: [
      { amount: 600.0, monetary_component_type: "base" },
      ...taxComponents,
    ],
    total_price: "672.000000",
    note: "",
    account: accountId,
    discount_configuration: null,
    service_resource: "service_request",
    service_resource_id: null,
    charge_item_definition: {
      id: "00000000-0000-4000-8000-00000000def0",
      status: "active",
      title: "Fasting Blood Glucose Test",
      slug: "f-fasting-blood-glucose-test",
      slug_config: {
        slug_type: "facility",
        slug_value: "fasting-blood-glucose-test",
      },
      description: "",
      purpose: "",
      price_components: [
        { amount: 600.0, monetary_component_type: "base" },
        ...taxComponents,
      ],
      category: null,
      tags: [],
      can_edit_charge_item: true,
    },
    tags: [],
    created_date: "2026-01-01T00:00:00Z",
    modified_date: "2026-01-01T00:00:00Z",
    created_by: user,
    updated_by: user,
    performer_actor: null,
  };
}

test.describe("Edit charge item with numeric tax factors", () => {
  test.use({ storageState: "tests/.auth/facilityAdmin.json" });

  test("saving a note on a charge item whose definition has tax components", async ({
    page,
  }) => {
    const facilityId = getFacilityId();
    const accountId = getAccountId();
    const chargeItem = buildChargeItem(accountId);
    const note = "Sample collected after 8 hours of fasting";

    await test.step("Stub the charge item list with a tax-bearing item", async () => {
      await page.route(
        (url) =>
          url.pathname.endsWith("/charge_item/") &&
          url.searchParams.get("account") === accountId,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ count: 1, results: [chargeItem] }),
          }),
      );
      await page.route("**/charge_item/upsert/", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ results: [] }),
        }),
      );
    });

    const dialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Edit Charge Item" }),
    });

    await test.step("Open the edit dialog for the charge item", async () => {
      await page.goto(
        `/facility/${facilityId}/billing/account/${accountId}/charge_items`,
      );
      const row = page.getByRole("row", { name: CHARGE_ITEM_TITLE });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "More Actions" }).click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      await expect(dialog).toBeVisible();
    });

    await test.step("Add a note", async () => {
      await dialog.getByRole("button", { name: "Note" }).click();
      await page.getByRole("textbox", { name: "Note" }).fill(note);
    });

    const upsertRequest = page.waitForRequest("**/charge_item/upsert/");
    await dialog.getByRole("button", { name: "Save" }).click();

    await test.step("Verify the update went through without validation errors", async () => {
      await expect(
        page.getByText("Invoice updated successfully"),
      ).toBeVisible();
      await expect(
        page.getByText(/expected string, received number/i),
      ).toHaveCount(0);

      const body = (await upsertRequest).postDataJSON() as {
        datapoints: Array<{
          note: string;
          unit_price_components: Array<{
            monetary_component_type: string;
            factor?: string | number | null;
          }>;
        }>;
      };
      const [item] = body.datapoints;
      expect(item.note).toBe(note);
      const sentTaxes = item.unit_price_components.filter(
        (component) => component.monetary_component_type === "tax",
      );
      expect(sentTaxes).toHaveLength(2);
      for (const tax of sentTaxes) {
        expect(typeof tax.factor).toBe("string");
      }
    });
  });
});
