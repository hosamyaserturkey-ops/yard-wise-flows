import { describe, expect, it } from "vitest";
import { buildCarTagHtml, buildSlotLabelsHtml, type SlotLabel } from "../lotPrint";
import { RECEIPT_PRINT_SCRIPT } from "../gateInReceipt";

const label = (code: string): SlotLabel => ({ code, zone: "A", row: "01", slot: code.slice(-2), note: null, qrSvg: `<svg data-code="${code}"></svg>` });

describe("slot labels", () => {
  it("puts one large label per sheet", () => {
    const html = buildSlotLabelsHtml([label("A-01-01"), label("A-01-02")], "large", "Everest Logistics - Car Lot");
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html).toContain('<svg data-code="A-01-01">');
    expect(html).toContain("Zone A · Row 01 · Slot 01");
  });

  it("puts 8 stickers on a sheet", () => {
    const html = buildSlotLabelsHtml(Array.from({ length: 9 }, (_, i) => label(`A-01-${String(i + 1).padStart(2, "0")}`)), "small", "Lot");
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html.match(/class="label"/g)).toHaveLength(9);
  });

  it("escapes what was typed and prints itself with the allowed script", () => {
    const html = buildSlotLabelsHtml([{ ...label("A-01-01"), note: "<b>exit</b>" }], "large", "Lot <script>");
    expect(html).not.toContain("<b>exit</b>");
    expect(html).toContain("&lt;b&gt;exit&lt;/b&gt;");
    expect(html).not.toContain("Lot <script>");
    expect(html).toContain(`<script>${RECEIPT_PRINT_SCRIPT}</script>`);
  });
});

describe("car tag", () => {
  it("carries the VIN, ticket and spot, escaped, and prints itself", () => {
    const html = buildCarTagHtml({
      vin: "JTDKB20U093000001", ticketNumber: 1042, manufacturerName: "Toyota & Sons", model: "Corolla · White",
      arrived: "2026-11-21T09:15:00Z", spot: "A / 01-01", yardName: "Everest Logistics - Car Lot", qrSvg: "<svg id=q></svg>",
    }, "Lot Admin", new Date(2026, 10, 21, 12, 0));
    expect(html).toContain("JTDKB20U093000001");
    expect(html).toContain("Ticket 1042");
    expect(html).toContain("Toyota &amp; Sons");
    expect(html).toContain("Spot: A / 01-01");
    expect(html).toContain("<svg id=q></svg>");
    expect(html).toContain(`<script>${RECEIPT_PRINT_SCRIPT}</script>`);
  });
});
