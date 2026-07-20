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

  const gateInDateRaw = new Date(containerData.gate_in_time);
  const dateStr = escapeHtml(gateInDateRaw.toLocaleDateString("en-GB").replace(/\//g, "/"));
  const timeStr = escapeHtml(gateInDateRaw.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  const ticketNum = String(parseInt(containerData.id.replace(/-/g, "").slice(0, 8), 16) % 1000000).padStart(6, "0");
  const yardName = escapeHtml(profile?.yard_name || "YARD");
  const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printedAt = escapeHtml(new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""));
  const containerNumberSafe = escapeHtml(containerData.container_number);
  const shippingLineSafe = escapeHtml(containerData.shipping_line);
  const truckNumberSafe = escapeHtml(containerData.truck_number);
  const driverNameSafe = escapeHtml(containerData.driver_name);

  const isoLabel = escapeHtml(ISO_DESCRIPTIONS[containerData.container_type] || containerData.container_type);
  const grade = escapeHtml(inspection?.grade || "—");
  const notes = inspection?.grade ? `Condition: ${escapeHtml(inspection.grade)}.` : "";

  const financialSection = demurragePayment ? `
      <div class="section">
        <div class="section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          FINANCIAL SUMMARY
        </div>
        <div class="demurrage-card">
          <div>
            <div class="demurrage-label">DEMURRAGE COLLECTED</div>
            <div class="demurrage-ar">غرامات التأخير المحصلة</div>
            <div class="demurrage-amount">${demurragePayment.totalCollected.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span class="demurrage-currency">JOD</span></div>
          </div>
          <div class="demurrage-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9"/></svg>
          </div>
        </div>
        <div class="demurrage-breakdown">
          <div class="breakdown-row"><span>Demurrage (${demurragePayment.chargeableDays} day${demurragePayment.chargeableDays !== 1 ? "s" : ""})</span><span>${demurragePayment.demurrageAmount.toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
          <div class="breakdown-row"><span>Service Fee</span><span>${Number(demurragePayment.serviceFee).toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
          <div class="breakdown-row method"><span>Payment Method</span><span>${demurragePayment.paymentMethod === "cash" ? "💵 Cash" : "📲 Qlick"}</span></div>
        </div>
      </div>
    ` : `
      <div class="section">
        <div class="section-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          FINANCIAL SUMMARY
        </div>
        <div class="no-demurrage">No demurrage collected — within free days or already paid.</div>
      </div>
    `;

  receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Reception Ticket — ${containerNumberSafe}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; color: #1e293b; }
    .page { max-width: 780px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }

    /* ── Header ── */
    .header { background: #1e3a5f; color: #fff; padding: 24px 32px 28px; position: relative; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .logo-text { color: #1e3a5f; font-weight: 800; font-size: 1.1rem; letter-spacing: 1px; }
    .header-center { text-align: center; flex: 1; padding: 0 24px; }
    .ticket-title { font-size: 1.7rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
    .ticket-title-ar { font-size: 0.9rem; color: #93c5fd; margin-top: 2px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .yard-name { font-size: 1.1rem; font-weight: 700; margin-top: 4px; letter-spacing: 1px; }
    .header-meta { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 10px; font-size: 0.85rem; color: #bfdbfe; }
    .ticket-num-box { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 4px 14px; font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; text-align: center; }
    .sl-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .sl-badge { background: #1e3a5f; color: #fff; border-radius: 6px; padding: 6px 14px; font-size: 1.1rem; font-weight: 800; letter-spacing: 2px; }
    .right-col { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

    /* ── Body ── */
    .body { padding: 0 32px 24px; }
    .section { border-bottom: 1px solid #e2e8f0; padding: 20px 0; }
    .section:last-of-type { border-bottom: none; }
    .section-header { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; }
    .field { }
    .field-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.05rem; color: #1e5fa0; letter-spacing: 1px; }
    .field-wide { grid-column: span 2; }

    /* ── Demurrage card ── */
    .demurrage-card { background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .demurrage-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #16a34a; }
    .demurrage-ar { font-size: 0.75rem; color: #4ade80; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .demurrage-amount { font-size: 2rem; font-weight: 800; color: #16a34a; margin-top: 8px; }
    .demurrage-currency { font-size: 1rem; font-weight: 600; }
    .demurrage-breakdown { font-size: 0.8rem; color: #475569; }
    .breakdown-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .breakdown-row:last-child { border: none; }
    .breakdown-row.method { color: #0f172a; font-weight: 600; }
    .no-demurrage { font-size: 0.85rem; color: #64748b; font-style: italic; padding: 8px 0; }

    /* ── Notes ── */
    .notes-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; min-height: 52px; font-size: 0.9rem; color: #334155; }

    /* ── Signatures ── */
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 24px 32px 20px; border-top: 1px solid #e2e8f0; }
    .sig { text-align: center; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 6px; margin-bottom: 4px; }
    .sig-name { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1e3a5f; }
    .sig-name-ar { font-size: 0.72rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.85rem; font-weight: 600; color: #334155; margin-top: 3px; }

    /* ── Footer bar ── */
    .footer-bar { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 10px 32px; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #94a3b8; }
    .footer-brand { font-weight: 700; color: #475569; }

    /* ── Print: compact everything so the ticket always fits one A4 page ── */
    @page { size: A4 portrait; margin: 8mm; }
    @media print {
      html { font-size: 13px; }
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { box-shadow: none; margin: 0; border-radius: 0; max-width: 100%; }
      .header { padding: 12px 24px 14px; }
      .header-meta { margin-top: 6px; }
      .body { padding: 0 24px 10px; }
      .section { padding: 10px 0; break-inside: avoid; }
      .section-header { margin-bottom: 8px; }
      .fields { gap: 8px 24px; }
      .demurrage-card { padding: 10px 16px; margin-bottom: 8px; }
      .demurrage-amount { font-size: 1.5rem; margin-top: 4px; }
      .notes-box { min-height: 34px; padding: 8px 14px; }
      /* Keep the top padding roomy — it is the blank space people sign in. */
      .signatures { padding: 26px 24px 10px; gap: 16px; break-inside: avoid; }
      .footer-bar { padding: 6px 24px; break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-inner">
      <div class="logo-box"><span class="logo-text">${yardName}</span></div>
      <div class="header-center">
        <div class="ticket-title">Reception Ticket</div>
        <div class="ticket-title-ar">وصل استلام حاوية</div>
        <div class="yard-name">${yardName}</div>
        <div class="header-meta">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
        </div>
      </div>
      <div class="right-col">
        <div class="ticket-num-box"># ${ticketNum}</div>
        <div class="sl-box"><span class="sl-badge">${shippingLineSafe}</span></div>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- Container Information -->
    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        CONTAINER INFORMATION
      </div>
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
          <div class="field-label">CONDITION / GRADE</div>
          <div class="field-value">${grade}</div>
        </div>
        <div class="field field-wide">
          <div class="field-label">RECEIVED AT</div>
          <div class="field-value">${yardName}</div>
        </div>
      </div>
    </div>

    <!-- Transport Information -->
    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        TRANSPORT INFORMATION
      </div>
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
    ${financialSection}

    <!-- Notes & Condition -->
    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        NOTES &amp; CONDITION
      </div>
      <div class="notes-box">${notes || "&nbsp;"}</div>
    </div>

  </div>

  <!-- Signatures -->
  <div class="signatures">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Shipping Line Rep.</div>
      <div class="sig-name-ar">ممثل الخط الملاحي</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer-bar">
    <span class="footer-brand">🏗 ${yardName}</span>
    <span>🔒 Official Document — Do not alter</span>
    <span>Printed: ${printedAt} by ${printedBy}</span>
  </div>

</div>
<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 300); };
</script>
</body>
</html>`);
  receiptWindow.document.close();
  return true;
};
