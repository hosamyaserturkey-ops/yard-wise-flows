// Gate-in reception ticket printing — builds the printable HTML document and
// opens it in a new window. No React state; safe values are escaped here.

import { escapeHtml } from "@/lib/utils";
import type {
  DemurragePaymentData,
  InsertedContainerRow,
  InspectionStatus,
} from "@/types/gateIn";

export interface ReceiptProfile {
  yard_name?: string | null;
  full_name?: string | null;
  username?: string | null;
}

export const ISO_DESCRIPTIONS: Record<string, string> = {
  "20FT": "20FT — 20ft Standard dry container",
  "40FT": "40FT — 40ft Standard dry container",
  "40HC": "40HC — 40ft High Cube dry container",
  "45FT": "45FT — 45ft High Cube dry container",
  "20FR": "20FR — 20ft Reefer container",
  "40FR": "40FR — 40ft Reefer container",
};

/** Shared gold accent used for financial emphasis across both ticket themes. */
export const RECEIPT_GOLD = "#C9A227";

/** Circular logo mark / large section watermark — stylised twin-peak mountain. */
export const mountainMarkSvg = (color: string): string => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><path d="M2 50 L18 24 L27 36 L40 12 L62 50 Z" fill="${color}"/><circle cx="47" cy="17" r="5" fill="${color}" opacity="0.55"/></svg>`;

/** Jagged mountain-silhouette decorative band for the bottom edge of the ticket. */
export const mountainBandSvg = (color: string): string => `<svg viewBox="0 0 780 40" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><polygon points="0,40 0,26 60,10 120,30 180,6 240,28 300,14 360,32 420,8 480,26 540,12 600,34 660,16 720,28 780,10 780,40" fill="${color}"/></svg>`;

export const truckWatermarkSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;

export const dollarWatermarkSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M12 8v8M9.5 10h3.2a1.4 1.4 0 0 1 0 2.8H9.5m0 0h3.6a1.4 1.4 0 0 1 0 2.8H9.5"/></svg>`;

export const clipboardWatermarkSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;

export const personSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>`;

export const shipSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><path d="M3 16l1.5 4h15L21 16"/><path d="M5 16l1-8h12l1 8"/><path d="M12 8V3M9 5h6"/></svg>`;

export const clipboardSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/></svg>`;

/** Shared ticket chrome (CSS) so gate-in and gate-out stay visually consistent, one navy tone apart. */
export const receiptCss = (navy: string, navyDark: string): string => `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #eef1f5; color: #1e293b; }
    .page { max-width: 780px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.14); }

    /* ── Header ── */
    .header { position: relative; background: #fff; overflow: hidden; }
    .header-navy { position: absolute; inset: 0; background: linear-gradient(135deg, ${navy}, ${navyDark}); clip-path: polygon(18% 0, 100% 0, 100% 100%, 0 100%); }
    .header-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 22px 30px 24px 74px; min-height: 108px; }
    .logo-mark { position: absolute; left: 22px; top: 50%; transform: translateY(-50%); width: 60px; height: 60px; border-radius: 50%; background: #fff; border: 3px solid ${navy}; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,.25); z-index: 2; padding: 9px; }
    .header-center { color: #fff; }
    .ticket-title { font-size: 1.55rem; font-weight: 800; letter-spacing: 3px; }
    .ticket-title-ar { font-size: 0.82rem; color: rgba(255,255,255,.72); margin-top: 2px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .header-divider { display: flex; align-items: center; gap: 8px; margin: 8px 0 6px; }
    .header-divider::before, .header-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,.35); }
    .diamond { width: 7px; height: 7px; background: ${RECEIPT_GOLD}; transform: rotate(45deg); flex: none; }
    .yard-name-header { font-size: 0.92rem; font-weight: 700; letter-spacing: 1px; color: rgba(255,255,255,.9); }
    .header-meta { display: flex; gap: 16px; margin-top: 6px; font-size: 0.76rem; color: rgba(255,255,255,.75); }
    .header-side { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
    .ticket-num-box { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.4); border-radius: 8px; padding: 5px 14px; color: #fff; font-size: 0.7rem; text-align: right; letter-spacing: 0.5px; }
    .ticket-num-box strong { display: block; font-size: 0.98rem; margin-top: 1px; }
    .sl-box { background: #fff; border-radius: 6px; padding: 6px 16px; }
    .sl-badge { color: ${navy}; font-weight: 800; font-size: 1.02rem; letter-spacing: 2px; }

    /* ── Body ── */
    .body { padding: 0 30px 22px; }
    .section { position: relative; border-bottom: 1px solid #e2e8f0; padding: 18px 0; overflow: hidden; }
    .section:last-of-type { border-bottom: none; }
    .watermark { position: absolute; right: -14px; top: -14px; width: 108px; height: 108px; opacity: 0.05; z-index: 0; pointer-events: none; }
    .section-pill { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 6px; background: ${navy}; color: #fff; border-radius: 999px; padding: 5px 16px; font-size: 0.66rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 13px; }
    .fields { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 13px 30px; }
    .field-label { font-size: 0.64rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.94rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.03rem; color: ${navy}; letter-spacing: 1px; }
    .field-wide { grid-column: span 2; }

    /* ── Financial card ── */
    .money-card { position: relative; z-index: 1; background: #F8F6EF; border: 1px solid ${RECEIPT_GOLD}; border-radius: 10px; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .money-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6d1a; }
    .money-ar { font-size: 0.73rem; color: #8a6d1a; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .money-amount { font-size: 1.9rem; font-weight: 800; color: ${RECEIPT_GOLD}; margin-top: 7px; }
    .money-currency { font-size: 0.95rem; font-weight: 600; }
    .money-breakdown { position: relative; z-index: 1; font-size: 0.79rem; color: #475569; }
    .breakdown-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .breakdown-row:last-child { border: none; }
    .breakdown-row.method { color: ${navy}; font-weight: 600; }
    .no-money { position: relative; z-index: 1; font-size: 0.84rem; color: #64748b; font-style: italic; padding: 6px 0; }

    /* ── Condition / Grade ── */
    .condition-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 100px; gap: 14px; align-items: stretch; }
    .notes-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; font-size: 0.86rem; color: #334155; min-height: 48px; }
    .notes-label { font-size: 0.6rem; font-weight: 700; letter-spacing: 1px; color: #94a3b8; margin-bottom: 4px; }
    .grade-box { border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; padding: 6px; }
    .grade-caption { font-size: 0.58rem; font-weight: 700; letter-spacing: 1.5px; opacity: 0.85; }
    .grade-letter { font-size: 1.7rem; font-weight: 800; line-height: 1; margin-top: 2px; }
    .grade-a { background: #15803d; }
    .grade-b { background: #b45309; }
    .grade-c { background: #b91c1c; }
    .grade-none { background: #64748b; }

    /* ── Signatures ── */
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; padding: 20px 30px 18px; border-top: 1px solid #e2e8f0; }
    .sig { text-align: center; }
    .sig-avatar { width: 36px; height: 36px; border-radius: 50%; background: #eef2f7; border: 1.5px solid ${navy}; display: flex; align-items: center; justify-content: center; margin: 0 auto 7px; padding: 7px; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 6px; margin-bottom: 4px; }
    .sig-name { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${navy}; }
    .sig-name-ar { font-size: 0.7rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.83rem; font-weight: 600; color: #334155; margin-top: 3px; }

    /* ── Footer ── */
    .footer-bar { background: ${navyDark}; color: rgba(255,255,255,.75); padding: 9px 30px; display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; }
    .footer-brand { font-weight: 700; color: #fff; }
    .mountain-band { background: ${navyDark}; line-height: 0; }
    .mountain-band svg { display: block; }

    /* ── Print: compact everything so the ticket always fits one A4 page ── */
    @page { size: A4 portrait; margin: 8mm; }
    @media print {
      html { font-size: 13px; }
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { box-shadow: none; margin: 0; border-radius: 0; max-width: 100%; }
      .header-inner { padding: 12px 22px 12px 62px; min-height: 88px; }
      .logo-mark { width: 48px; height: 48px; left: 16px; }
      .header-meta { margin-top: 4px; }
      .body { padding: 0 22px 8px; }
      .section { padding: 9px 0; break-inside: avoid; }
      .section-pill { margin-bottom: 7px; }
      .fields { gap: 7px 22px; }
      .money-card { padding: 9px 14px; margin-bottom: 7px; }
      .money-amount { font-size: 1.4rem; margin-top: 3px; }
      .notes-box { min-height: 30px; padding: 7px 12px; }
      /* Keep the top padding roomy — it is the blank space people sign in. */
      .signatures { padding: 22px 22px 8px; gap: 14px; break-inside: avoid; }
      .footer-bar { padding: 5px 22px; break-inside: avoid; }
    }
  `;

/**
 * Opens the reception ticket in a new window and triggers printing.
 * Returns false when the pop-up was blocked so the caller can notify the user.
 */
export const printGateInReceipt = (
  containerData: InsertedContainerRow,
  demurragePayment: DemurragePaymentData | undefined,
  inspection: InspectionStatus | null | undefined,
  profile: ReceiptProfile | null | undefined,
): boolean => {
  const receiptWindow = window.open("", "_blank");
  if (!receiptWindow) return false;

  const NAVY = "#1B3A5C";
  const NAVY_DARK = "#14293F";

  const gateInDateRaw = new Date(containerData.gate_in_time);
  const dateStr = escapeHtml(gateInDateRaw.toLocaleDateString("en-GB"));
  const timeStr = escapeHtml(gateInDateRaw.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  const ticketNum = String(containerData.ticket_number).padStart(6, "0");
  const yardName = escapeHtml(profile?.yard_name || "YARD");
  const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printedAt = escapeHtml(new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""));
  const containerNumberSafe = escapeHtml(containerData.container_number);
  const shippingLineSafe = escapeHtml(containerData.shipping_line);
  const truckNumberSafe = escapeHtml(containerData.truck_number);
  const driverNameSafe = escapeHtml(containerData.driver_name);

  const isoLabel = escapeHtml(ISO_DESCRIPTIONS[containerData.container_type] || containerData.container_type);
  const gradeRaw = (inspection?.grade || "").trim().toUpperCase();
  const grade = escapeHtml(gradeRaw || "—");
  const gradeClass = gradeRaw === "A" ? "grade-a" : gradeRaw === "B" ? "grade-b" : gradeRaw === "C" ? "grade-c" : "grade-none";
  const notes = gradeRaw ? `Condition assessed at inspection: Grade ${escapeHtml(gradeRaw)}.` : "No remarks recorded.";

  const dollarIcon = dollarWatermarkSvg(RECEIPT_GOLD).replace('width="100%" height="100%"', 'width="32" height="32"').replace('stroke-width="1.2"', 'stroke-width="1.5"');

  const financialSection = demurragePayment ? `
      <div class="money-card">
        <div>
          <div class="money-label">DEMURRAGE COLLECTED</div>
          <div class="money-ar">غرامات التأخير المحصلة</div>
          <div class="money-amount">${demurragePayment.totalCollected.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span class="money-currency">JOD</span></div>
        </div>
        <div>${dollarIcon}</div>
      </div>
      <div class="money-breakdown">
        <div class="breakdown-row"><span>Demurrage (${demurragePayment.chargeableDays} day${demurragePayment.chargeableDays !== 1 ? "s" : ""})</span><span>${demurragePayment.demurrageAmount.toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
        <div class="breakdown-row"><span>Service Fee</span><span>${Number(demurragePayment.serviceFee).toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
        <div class="breakdown-row method"><span>Payment Method</span><span>${demurragePayment.paymentMethod === "cash" ? "💵 Cash" : "📲 Qlick"}</span></div>
      </div>
    ` : `
      <div class="no-money">No demurrage collected — within free days or already paid.</div>
    `;

  receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Reception Ticket — ${containerNumberSafe}</title>
  <style>${receiptCss(NAVY, NAVY_DARK)}</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-navy"></div>
    <div class="header-inner">
      <div class="logo-mark">${mountainMarkSvg(NAVY)}</div>
      <div class="header-center">
        <div class="ticket-title">RECEPTION TICKET</div>
        <div class="ticket-title-ar">وصل استلام حاوية</div>
        <div class="header-divider"><span class="diamond"></span></div>
        <div class="yard-name-header">${yardName}</div>
        <div class="header-meta">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
        </div>
      </div>
      <div class="header-side">
        <div class="ticket-num-box">TICKET NO.<strong># ${ticketNum}</strong></div>
        <div class="sl-box"><span class="sl-badge">${shippingLineSafe}</span></div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- Container Information -->
    <div class="section">
      <div class="watermark">${mountainMarkSvg(NAVY)}</div>
      <div class="section-pill">📦 Container Information</div>
      <div class="fields">
        <div class="field field-wide">
          <div class="field-label">CONTAINER NUMBER</div>
          <div class="field-value mono">${containerNumberSafe}</div>
        </div>
        <div class="field field-wide">
          <div class="field-label">ISO TYPE / SIZE</div>
          <div class="field-value">${isoLabel}</div>
        </div>
        <div class="field">
          <div class="field-label">SHIPPING LINE</div>
          <div class="field-value">${shippingLineSafe}</div>
        </div>
        <div class="field">
          <div class="field-label">RECEIVED AT</div>
          <div class="field-value">${yardName}</div>
        </div>
      </div>
    </div>

    <!-- Transport Information -->
    <div class="section">
      <div class="watermark">${truckWatermarkSvg(NAVY)}</div>
      <div class="section-pill">🚚 Transport Information</div>
      <div class="fields">
        <div class="field">
          <div class="field-label">TRUCK NUMBER</div>
          <div class="field-value">${truckNumberSafe}</div>
        </div>
        <div class="field">
          <div class="field-label">DRIVER NAME</div>
          <div class="field-value">${driverNameSafe}</div>
        </div>
      </div>
    </div>

    <!-- Financial Summary -->
    <div class="section">
      <div class="watermark">${dollarWatermarkSvg(NAVY)}</div>
      <div class="section-pill">💰 Financial Summary</div>
      ${financialSection}
    </div>

    <!-- Condition & Grade -->
    <div class="section">
      <div class="watermark">${clipboardWatermarkSvg(NAVY)}</div>
      <div class="section-pill">📝 Condition &amp; Grade</div>
      <div class="condition-grid">
        <div class="notes-box">
          <div class="notes-label">CONDITION / NOTES</div>
          <div>${notes}</div>
        </div>
        <div class="grade-box ${gradeClass}">
          <div class="grade-caption">GRADE</div>
          <div class="grade-letter">${grade}</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Signatures -->
  <div class="signatures">
    <div class="sig">
      <div class="sig-avatar">${personSigSvg(NAVY)}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-avatar">${shipSigSvg(NAVY)}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Shipping Line Rep.</div>
      <div class="sig-name-ar">ممثل الخط الملاحي</div>
    </div>
    <div class="sig">
      <div class="sig-avatar">${clipboardSigSvg(NAVY)}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer-bar">
    <span class="footer-brand">🏔 ${yardName}</span>
    <span>🔒 Official Document — Do not alter</span>
    <span>Printed: ${printedAt} by ${printedBy}</span>
  </div>
  <div class="mountain-band">${mountainBandSvg(NAVY)}</div>

</div>
<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 300); };
</script>
</body>
</html>`);
  receiptWindow.document.close();
  return true;
};
