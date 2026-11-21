/**
 * Printed slot labels and car tags. Plain HTML pages, printed the same way as the
 * gate tickets (the window opens at the click, then prints itself with the
 * CSP-allowed RECEIPT_PRINT_SCRIPT). QR drawings are passed in as SVG text, so
 * these builders are pure and every typed value goes through escapeHtml.
 */
import { RECEIPT_PRINT_SCRIPT } from "@/lib/gateInReceipt";
import { formatDate, formatDateTime } from "@/lib/format";
import { escapeHtml } from "@/lib/utils";

export type LabelSize = "large" | "small";

export interface SlotLabel {
  code: string;
  zone: string;
  row: string | null;
  slot: string | null;
  /** Printed after the name parts, e.g. "Receiving"; none for a plain storage slot. */
  note: string | null;
  qrSvg: string;
}

const PAGE_CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
  .qr svg { display: block; width: 100%; height: auto; }
  @media screen { body { background: #f3f4f6; } .sheet { background: #fff; margin: 12px auto; box-shadow: 0 1px 4px rgba(0,0,0,.15); } }
`;

function partsLine(l: Pick<SlotLabel, "zone" | "row" | "slot">): string {
  return [`Zone ${l.zone}`, l.row ? `Row ${l.row}` : null, l.slot ? `Slot ${l.slot}` : null].filter(Boolean).join(" · ");
}

/** A page of QR labels for slots: one big label per A4 sheet, or 8 stickers per sheet. */
export function buildSlotLabelsHtml(labels: SlotLabel[], size: LabelSize, yardName: string): string {
  const yard = escapeHtml(yardName);
  const one = (l: SlotLabel) => `
    <div class="label">
      <div class="qr">${l.qrSvg}</div>
      <div class="code">${escapeHtml(l.code)}</div>
      <div class="parts">${escapeHtml(partsLine(l))}${l.note ? ` · ${escapeHtml(l.note)}` : ""}</div>
      <div class="yard">${yard} · scan to place a car here</div>
    </div>`;
  const css = size === "large"
    ? `.sheet { width: 190mm; min-height: 277mm; page-break-after: always; display: flex; align-items: center; justify-content: center; }
       .sheet:last-child { page-break-after: auto; }
       .label { width: 170mm; text-align: center; }
       .qr { width: 150mm; margin: 0 auto; }
       .code { font-size: 64pt; font-weight: 700; letter-spacing: 2px; margin-top: 6mm; }
       .parts { font-size: 18pt; margin-top: 2mm; }
       .yard { font-size: 11pt; color: #555; margin-top: 4mm; }`
    : `.sheet { width: 190mm; min-height: 277mm; page-break-after: always; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 69mm; }
       .sheet:last-child { page-break-after: auto; }
       .label { border: 1px dashed #bbb; padding: 4mm; display: grid; grid-template-columns: 46mm 1fr; grid-template-rows: auto auto 1fr; column-gap: 4mm; align-content: center; }
       .qr { grid-row: 1 / 4; width: 46mm; }
       .code { font-size: 22pt; font-weight: 700; align-self: end; }
       .parts { font-size: 10pt; }
       .yard { font-size: 8pt; color: #555; align-self: start; margin-top: 2mm; }`;
  const perSheet = size === "large" ? 1 : 8;
  const sheets: string[] = [];
  for (let i = 0; i < labels.length; i += perSheet) {
    sheets.push(`<div class="sheet">${labels.slice(i, i + perSheet).map(one).join("")}</div>`);
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Slot labels</title>
<style>${PAGE_CSS}${css}</style></head><body>${sheets.join("")}
<script>${RECEIPT_PRINT_SCRIPT}</script></body></html>`;
}

export interface CarTagData {
  vin: string;
  ticketNumber: number;
  manufacturerName: string;
  model: string;
  arrived: string;
  spot: string;
  yardName: string;
  qrSvg: string;
}

/** The tag that goes on a car's dashboard: a QR to scan when moving it, and the VIN to read. */
export function buildCarTagHtml(d: CarTagData, printedBy: string, now: Date): string {
  const vin = escapeHtml(d.vin);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Car tag ${vin}</title>
<style>${PAGE_CSS}
  .sheet { width: 190mm; padding: 6mm 0; }
  .tag { width: 148mm; height: 105mm; margin: 0 auto; border: 1px dashed #888; border-radius: 3mm; padding: 6mm;
         display: grid; grid-template-columns: 58mm 1fr; column-gap: 6mm; }
  .qr { width: 58mm; align-self: center; }
  .vin { font-family: "Courier New", monospace; font-size: 17pt; font-weight: 700; letter-spacing: 1px; word-break: break-all; }
  .big { font-size: 26pt; font-weight: 700; margin: 2mm 0; }
  .row { font-size: 11pt; margin-top: 1.5mm; }
  .muted { color: #555; font-size: 8.5pt; margin-top: 3mm; }
  .cut { text-align: center; font-size: 8pt; color: #888; margin-top: 2mm; }
</style></head><body><div class="sheet">
  <div class="tag">
    <div class="qr">${d.qrSvg}</div>
    <div>
      <div class="vin">${vin}</div>
      <div class="big">Ticket ${d.ticketNumber}</div>
      <div class="row">${escapeHtml(d.manufacturerName)}${d.model ? ` · ${escapeHtml(d.model)}` : ""}</div>
      <div class="row">Arrived ${escapeHtml(formatDate(d.arrived))}</div>
      <div class="row">Spot: ${escapeHtml(d.spot || "—")}</div>
      <div class="muted">${escapeHtml(d.yardName)} · scan this tag to move the car<br>Printed ${escapeHtml(formatDateTime(now))} by ${escapeHtml(printedBy)}</div>
    </div>
  </div>
  <div class="cut">✂ cut along the dashed line · place on the dashboard, QR facing up</div>
</div>
<script>${RECEIPT_PRINT_SCRIPT}</script></body></html>`;
}

/**
 * Opens the print window straight from the click, as pop-up rules require; the
 * page is written into it once its QR codes are drawn. Null when blocked.
 */
export function openPrintWindow(what: string): Window | null {
  const win = window.open("", "_blank");
  if (win) win.document.write(`<!DOCTYPE html><title>${escapeHtml(what)}</title><p style="font-family:sans-serif;padding:24px">Preparing the ${escapeHtml(what.toLowerCase())}…</p>`);
  return win;
}

/** Puts a page into a window that was opened at the click (pop-up rules). */
export function writePage(win: Window, html: string): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
}
