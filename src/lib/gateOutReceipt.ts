// Gate-out ticket printing — builds the printable HTML document and opens it
// in a new window. Extracted from GateOut.tsx so the ticket can also be
// reprinted later from ContainerDetailDialog. The header date/time and the
// GATE-OUT field come from the stored gate-out time (not "now"), so a
// reprint shows the real exit date; at the gate the caller passes new Date().

import { escapeHtml } from "@/lib/utils";
import { ISO_DESCRIPTIONS, type ReceiptProfile } from "@/lib/gateInReceipt";

export interface GateOutReceiptData {
  /** Sequential ticket number for this visit — shared with the gate-in ticket. */
  ticket_number: number;
  container_number: string;
  container_type: string;
  shipping_line: string;
  booking_number: string | null;
  truck_number: string | null;
  driver_name: string | null;
  gate_in_time: Date;
  gate_out_time: Date;
  fees: number;
}

/**
 * Opens the gate-out ticket in a new window and triggers printing.
 * Returns false when the pop-up was blocked so the caller can notify the user.
 */
export const printGateOutReceipt = (
  data: GateOutReceiptData,
  profile: ReceiptProfile | null | undefined,
): boolean => {
  const receiptWindow = window.open("", "_blank");
  if (!receiptWindow) return false;

  const outTime = data.gate_out_time;
  const dateStr = escapeHtml(outTime.toLocaleDateString("en-GB"));
  const timeStr = escapeHtml(outTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  const ticketNum = String(data.ticket_number).padStart(6, "0");
  const yardName = escapeHtml(profile?.yard_name || "YARD");
  const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printedAt = escapeHtml(new Date()
    .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(",", ""));

  const isoLabel = escapeHtml(ISO_DESCRIPTIONS[data.container_type] || data.container_type);
  const gateInStr = escapeHtml(`${data.gate_in_time.toLocaleDateString("en-GB")} ${data.gate_in_time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`);
  const feeStr = Number(data.fees || 0).toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const containerNumberSafe = escapeHtml(data.container_number);
  const shippingLineSafe = escapeHtml(data.shipping_line);
  const bookingNumberSafe = escapeHtml(data.booking_number || "—");
  const truckNumberSafe = escapeHtml(data.truck_number || "—");
  const driverNameSafe = escapeHtml(data.driver_name || "—");

  receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Gate-Out Ticket — ${containerNumberSafe}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; color: #1e293b; }
    .page { max-width: 780px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }

    .header { background: #134e4a; color: #fff; padding: 24px 32px 28px; }
    .header-inner { display: flex; align-items: center; justify-content: space-between; }
    .logo-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .logo-text { color: #134e4a; font-weight: 800; font-size: 1.1rem; letter-spacing: 1px; }
    .header-center { text-align: center; flex: 1; padding: 0 24px; }
    .ticket-title { font-size: 1.7rem; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
    .ticket-title-ar { font-size: 0.9rem; color: #99f6e4; margin-top: 2px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .yard-name { font-size: 1.1rem; font-weight: 700; margin-top: 4px; letter-spacing: 1px; }
    .header-meta { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 10px; font-size: 0.85rem; color: #ccfbf1; }
    .ticket-num-box { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 4px 14px; font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; text-align: center; }
    .sl-box { background: #fff; border-radius: 8px; padding: 8px 16px; min-width: 100px; min-height: 52px; display: flex; align-items: center; justify-content: center; }
    .sl-badge { background: #134e4a; color: #fff; border-radius: 6px; padding: 6px 14px; font-size: 1.1rem; font-weight: 800; letter-spacing: 2px; }
    .right-col { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

    .body { padding: 0 32px 24px; }
    .section { border-bottom: 1px solid #e2e8f0; padding: 20px 0; }
    .section:last-of-type { border-bottom: none; }
    .section-header { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; }
    .field-label { font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.05rem; color: #134e4a; letter-spacing: 1px; }
    .field-wide { grid-column: span 2; }

    .fees-card { background: #ecfeff; border: 1px solid #67e8f9; border-radius: 10px; padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; }
    .fees-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #0e7490; }
    .fees-ar { font-size: 0.75rem; color: #22d3ee; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .fees-amount { font-size: 2rem; font-weight: 800; color: #0e7490; margin-top: 8px; }
    .fees-currency { font-size: 1rem; font-weight: 600; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; padding: 24px 32px 20px; border-top: 1px solid #e2e8f0; }
    .sig { text-align: center; }
    .sig-line { border-top: 1.5px solid #334155; padding-top: 6px; margin-bottom: 4px; }
    .sig-name { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #134e4a; }
    .sig-name-ar { font-size: 0.72rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.85rem; font-weight: 600; color: #334155; margin-top: 3px; }

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
      .fees-card { padding: 10px 16px; }
      .fees-amount { font-size: 1.5rem; margin-top: 4px; }
      /* Keep the top padding roomy — it is the blank space people sign in. */
      .signatures { padding: 26px 24px 10px; gap: 16px; break-inside: avoid; }
      .footer-bar { padding: 6px 24px; break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-inner">
      <div class="logo-box"><span class="logo-text">${yardName}</span></div>
      <div class="header-center">
        <div class="ticket-title">Gate-Out Ticket</div>
        <div class="ticket-title-ar">وصل تسليم حاوية</div>
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

  <div class="body">

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
          <div class="field-label">BOOKING NUMBER</div>
          <div class="field-value mono">${bookingNumberSafe}</div>
        </div>
      </div>
    </div>

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
        <div class="field">
          <div class="field-label">GATE-IN</div>
          <div class="field-value">${gateInStr}</div>
        </div>
        <div class="field">
          <div class="field-label">GATE-OUT</div>
          <div class="field-value">${dateStr} ${timeStr}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        FINANCIAL SUMMARY
      </div>
      <div class="fees-card">
        <div>
          <div class="fees-label">GATE-OUT FEES COLLECTED</div>
          <div class="fees-ar">رسوم الخروج المحصلة</div>
          <div class="fees-amount">${feeStr} <span class="fees-currency">JOD</span></div>
        </div>
        <div>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0e7490" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9"/></svg>
        </div>
      </div>
    </div>

  </div>

  <div class="signatures">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Booking Representative</div>
      <div class="sig-name-ar">ممثل الحجز</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

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
