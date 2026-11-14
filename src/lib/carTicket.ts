// Car-lot gate tickets (reception on arrival, release on departure). Built as a
// plain HTML string so it can be tested, then opened in a new window and printed
// exactly like the container tickets, with the same look and the same print
// script (the app's Content-Security-Policy allows that one script by hash).
// No billing and no liability wording: neither is decided yet.

import { escapeHtml } from "@/lib/utils";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import {
  BLUE, RECEIPT_PRINT_SCRIPT, clipboardSigSvg, containerSvg, documentSvg, everestLogoSvg, mountainBandSvg,
  operatorSignatureName, personSigSvg, receiptCss, truckWatermarkSvg,
  type ReceiptContext, type ReceiptProfile,
} from "@/lib/gateInReceipt";
import { FUEL_LEVELS } from "@/lib/inspection";

export type CarTicketKind = "gate_in" | "gate_out";

/** The condition recorded by the closed arrival inspection, if there is one. */
export interface TicketCondition {
  odometer: number | null;
  fuelLevel: string | null;
  keysPresent: boolean | null;
  notes: string | null;
  /** One line per damage photo: what and where. */
  damageNotes: string[];
}

export interface CarTicketData {
  kind: CarTicketKind;
  ticketNumber: number | null;
  yardName: string;
  manufacturerName: string;
  manufacturerCode: string;
  vin: string;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  gateInTime: string;
  gateOutTime: string | null;
  lotZone: string | null;
  lotSlot: string | null;
  driverName: string | null;
  truckNumber: string | null;
  gateOutDriverName: string | null;
  gateOutTruckNumber: string | null;
  odometerIn: number | null;
  odometerOut: number | null;
  keyCount: number | null;
  daysStored: number;
  /** Who received the car (gate-in) or released it (gate-out), from the visit record. */
  operatorName: string | null;
  condition: TicketCondition | null;
}

const MAX_DAMAGE_LINES = 8;

const dash = "—";
const text = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return escapeHtml(s || dash);
};
const km = (n: number | null): string => (n === null ? dash : `${n.toLocaleString("en")} km`);

const FUEL_LABEL = Object.fromEntries(FUEL_LEVELS.map((f) => [f.id, f.label])) as Record<string, string>;

/** The full printable document. Every typed value goes through escapeHtml. */
export function buildCarTicketHtml(
  data: CarTicketData,
  profile: ReceiptProfile | null | undefined,
  context?: ReceiptContext,
  now: Date = new Date(),
): string {
  const isOut = data.kind === "gate_out";
  const when = new Date(isOut && data.gateOutTime ? data.gateOutTime : data.gateInTime);
  const ticketNum = data.ticketNumber != null ? String(data.ticketNumber).padStart(6, "0") : dash;
  const yardRaw = data.yardName || "CAR LOT";
  const words = yardRaw.trim().split(/\s+/);
  const operator = escapeHtml(operatorSignatureName(profile, { ...context, operatorName: data.operatorName }));
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printLabel = context?.isReprint ? "Reprinted" : "Printed";
  const title = isOut ? "VEHICLE RELEASE TICKET" : "VEHICLE RECEPTION TICKET";
  const titleAr = isOut ? "وصل تسليم مركبة" : "وصل استلام مركبة";
  const car = [data.model, data.modelYear, data.color].filter((v) => v !== null && String(v).trim() !== "").join(" · ");
  const spot = [data.lotZone, data.lotSlot].filter(Boolean).join(" / ");

  const c = data.condition;
  const damage = (c?.damageNotes ?? []).slice(0, MAX_DAMAGE_LINES);
  const moreDamage = (c?.damageNotes.length ?? 0) - damage.length;
  const conditionSection = !isOut && c ? `
    <div class="section">
      <div class="section-pill"><span class="pill-ico">${documentSvg("#fff")}</span> Condition at arrival</div>
      <div class="content fields">
        <div class="field"><div class="field-label">ODOMETER</div><div class="field-value">${km(c.odometer)}</div></div>
        <div class="field"><div class="field-label">FUEL</div><div class="field-value">${text(c.fuelLevel ? FUEL_LABEL[c.fuelLevel] ?? c.fuelLevel : null)}</div></div>
        <div class="field"><div class="field-label">KEYS PRESENT</div><div class="field-value">${c.keysPresent === null ? dash : c.keysPresent ? "Yes" : "No"}</div></div>
        <div class="field"><div class="field-label">DAMAGE NOTED</div><div class="field-value">${damage.length ? `${c.damageNotes.length}` : "None"}</div></div>
        ${damage.length ? `<div class="field" style="grid-column: 1 / -1"><ul class="damage-list">${damage.map((d) => `<li>${text(d)}</li>`).join("")}${moreDamage > 0 ? `<li>+ ${moreDamage} more in the inspection record</li>` : ""}</ul></div>` : ""}
        ${c.notes ? `<div class="field" style="grid-column: 1 / -1"><div class="field-label">NOTES</div><div class="field-value">${text(c.notes)}</div></div>` : ""}
      </div>
    </div>` : "";

  const stay = isOut ? `
    <div class="section">
      <div class="section-pill"><span class="pill-ico">${documentSvg("#fff")}</span> Stay</div>
      <div class="content fields">
        <div class="field"><div class="field-label">ARRIVED</div><div class="field-value">${escapeHtml(formatDateTime(new Date(data.gateInTime)))}</div></div>
        <div class="field"><div class="field-label">RELEASED</div><div class="field-value">${data.gateOutTime ? escapeHtml(formatDateTime(new Date(data.gateOutTime))) : dash}</div></div>
        <div class="field"><div class="field-label">DAYS STORED</div><div class="field-value">${data.daysStored}</div></div>
        <div class="field"><div class="field-label">ODOMETER AT ARRIVAL / RELEASE</div><div class="field-value">${km(data.odometerIn)} / ${km(data.odometerOut)}</div></div>
      </div>
    </div>` : "";

  const driver = isOut ? data.gateOutDriverName : data.driverName;
  const truck = isOut ? data.gateOutTruckNumber : data.truckNumber;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${isOut ? "Release" : "Reception"} Ticket — ${text(data.vin)}</title>
  <style>${receiptCss()}
    /* "VEHICLE RECEPTION TICKET" is longer than the container titles: keep it on one line. */
    .ticket-title { font-size: 1.3rem; letter-spacing: 1px; white-space: nowrap; }
    .signatures { grid-template-columns: 1fr 1fr; }
    .damage-list { margin: 0; padding-left: 18px; font-size: 0.85rem; color: #334155; }
    .damage-list li { margin: 2px 0; }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="logo-panel">
      <div class="logo-mark">${everestLogoSvg()}</div>
      <div class="logo-word">
        <div class="logo-1">${escapeHtml(words[0] || "CAR LOT")}</div>
        ${words.length > 1 ? `<div class="logo-2">${escapeHtml(words.slice(1).join(" "))}</div>` : ""}
      </div>
    </div>
    <div class="title-block">
      <div class="ticket-title">${title}</div>
      <div class="ticket-title-ar">${titleAr}</div>
      <div class="header-divider"><span class="diamond"></span></div>
      <div class="yard-name-header">${escapeHtml(yardRaw)}</div>
      <div class="header-meta"><span>📅 ${escapeHtml(formatDate(when))}</span><span class="sep">|</span><span>🕐 ${escapeHtml(formatTime(when))}</span></div>
    </div>
    <div class="badges">
      <div class="ticket-no"><span>TICKET NO.</span><strong># ${ticketNum}</strong></div>
      <div class="sl-badge">${text(data.manufacturerCode)}</div>
    </div>
  </div>

  <div class="body">
    <div class="section">
      <div class="wm-clip"><div class="watermark">${everestLogoSvg()}</div></div>
      <div class="section-pill"><span class="pill-ico">${containerSvg("#fff")}</span> Vehicle Information</div>
      <div class="content cinfo">
        <div class="cinfo-left">
          <div class="field"><div class="field-label">VIN</div><div class="field-value mono">${text(data.vin)}</div></div>
          <div class="field"><div class="field-label">MODEL / YEAR / COLOUR</div><div class="field-value">${text(car)}</div></div>
          <div class="field"><div class="field-label">MANUFACTURER</div><div class="field-value">${text(data.manufacturerName)}</div></div>
        </div>
        <div class="cinfo-right">
          <div class="field"><div class="field-label">SPOT (ZONE / SLOT)</div><div class="field-value big">${text(spot)}</div></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="wm-clip"><div class="watermark">${truckWatermarkSvg(BLUE)}</div></div>
      <div class="section-pill"><span class="pill-ico">${truckWatermarkSvg("#fff")}</span> Transport Information</div>
      <div class="content fields">
        <div class="field"><div class="field-label">TRUCK NUMBER</div><div class="field-value">${text(truck)}</div></div>
        <div class="field"><div class="field-label">DRIVER NAME</div><div class="field-value">${text(driver)}</div></div>
        ${isOut ? "" : `<div class="field"><div class="field-label">ODOMETER</div><div class="field-value">${km(data.odometerIn)}</div></div>
        <div class="field"><div class="field-label">KEYS</div><div class="field-value">${text(data.keyCount)}</div></div>`}
      </div>
    </div>
    ${conditionSection}
    ${stay}
  </div>

  <div class="signatures">
    <div class="sig">
      <div class="sig-avatar">${personSigSvg("#fff")}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-avatar">${clipboardSigSvg("#fff")}</div>
      <div class="sig-line"></div>
      <div class="sig-name">${isOut ? "Released By" : "Received By"}</div>
      <div class="sig-name-ar">${isOut ? "سلّمها" : "استلمها"}</div>
      <div class="sig-value">${operator}</div>
    </div>
  </div>

  <div class="mountain-band">${mountainBandSvg("#9fc0ea")}</div>
  <div class="footer-bar">
    <span class="footer-brand">🏔 ${escapeHtml(yardRaw)}</span>
    <span>🔒 Official Document — Do not alter</span>
    <span>${printLabel}: ${escapeHtml(formatDateTime(now))} by ${printedBy}</span>
  </div>

</div>
<script>${RECEIPT_PRINT_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Prints the ticket in a new window. Returns false when the pop-up was blocked,
 * so the caller can tell the user to allow pop-ups.
 *
 * Browsers only allow a pop-up straight after a tap or click, not after waiting
 * for the network. So a caller that has to load data first opens the window
 * itself at the click (`openTicketWindow`), then passes it here once the data is
 * ready, and closes it if loading fails.
 */
export function printCarTicket(
  data: CarTicketData,
  profile: ReceiptProfile | null | undefined,
  context?: ReceiptContext,
  target?: Window | null,
): boolean {
  const html = buildCarTicketHtml(data, profile, context);
  const win = target ?? window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

/** Opens the (still empty) ticket window. Call it directly from the click handler. */
export function openTicketWindow(): Window | null {
  const win = window.open("", "_blank");
  if (win) win.document.write("<!DOCTYPE html><title>Ticket</title><p style=\"font-family:sans-serif;padding:24px\">Preparing the ticket…</p>");
  return win;
}
