// Gate-out ticket printing — builds the printable HTML document and opens it
// in a new window. Extracted from GateOut.tsx so the ticket can also be
// reprinted later from ContainerDetailDialog. The header date/time and the
// GATE-OUT field come from the stored gate-out time (not "now"), so a
// reprint shows the real exit date; at the gate the caller passes new Date().

import { escapeHtml } from "@/lib/utils";
import {
  BLUE,
  ISO_DESCRIPTIONS,
  clipboardDollarSvg,
  clipboardSigSvg,
  containerSvg,
  everestLogoSvg,
  mountainBandSvg,
  personSigSvg,
  receiptCss,
  shipSigSvg,
  truckWatermarkSvg,
  type ReceiptProfile,
} from "@/lib/gateInReceipt";

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
  const yardNameRaw = profile?.yard_name || "YARD";
  const yardName = escapeHtml(yardNameRaw);
  const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printedAt = escapeHtml(new Date()
    .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(",", ""));

  const words = yardNameRaw.trim().split(/\s+/);
  const logoLine1 = escapeHtml(words[0] || "YARD");
  const logoLine2 = escapeHtml(words.slice(1).join(" "));

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
  <style>${receiptCss()}</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="logo-panel">
      <div class="logo-mark">${everestLogoSvg()}</div>
      <div class="logo-word">
        <div class="logo-1">${logoLine1}</div>
        ${logoLine2 ? `<div class="logo-2">${logoLine2}</div>` : ""}
      </div>
    </div>
    <div class="title-block">
      <div class="ticket-title">GATE-OUT TICKET</div>
      <div class="ticket-title-ar">وصل تسليم حاوية</div>
      <div class="header-divider"><span class="diamond"></span></div>
      <div class="yard-name-header">${yardName}</div>
      <div class="header-meta"><span>📅 ${dateStr}</span><span class="sep">|</span><span>🕐 ${timeStr}</span></div>
    </div>
    <div class="badges">
      <div class="ticket-no"><span>TICKET NO.</span><strong># ${ticketNum}</strong></div>
      <div class="sl-badge">${shippingLineSafe}</div>
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- Container Information -->
    <div class="section">
      <div class="wm-clip"><div class="watermark">${everestLogoSvg()}</div></div>
      <div class="section-pill"><span class="pill-ico">${containerSvg("#fff")}</span> Container Information</div>
      <div class="content fields">
        <div class="field">
          <div class="field-label">CONTAINER NUMBER</div>
          <div class="field-value mono">${containerNumberSafe}</div>
        </div>
        <div class="field">
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

    <!-- Transport Information -->
    <div class="section">
      <div class="wm-clip"><div class="watermark">${truckWatermarkSvg(BLUE)}</div></div>
      <div class="section-pill"><span class="pill-ico">${truckWatermarkSvg("#fff")}</span> Transport Information</div>
      <div class="content fields">
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

    <!-- Financial Summary -->
    <div class="section">
      <div class="wm-clip"><div class="watermark">${clipboardDollarSvg(BLUE)}</div></div>
      <div class="section-pill"><span class="pill-ico">${clipboardDollarSvg("#fff")}</span> Financial Summary</div>
      <div class="content">
        <div class="money-card">
          <div>
            <div class="money-label">GATE-OUT FEES COLLECTED</div>
            <div class="money-ar">رسوم الخروج المحصلة</div>
            <div class="money-amount">${feeStr} <span class="money-currency">JOD</span></div>
          </div>
          <div class="money-icon">${clipboardDollarSvg(BLUE)}</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Signatures -->
  <div class="signatures">
    <div class="sig">
      <div class="sig-avatar">${personSigSvg("#fff")}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Driver Signature</div>
      <div class="sig-name-ar">توقيع السائق</div>
    </div>
    <div class="sig">
      <div class="sig-avatar">${shipSigSvg("#fff")}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Booking Representative</div>
      <div class="sig-name-ar">ممثل الحجز</div>
    </div>
    <div class="sig">
      <div class="sig-avatar">${clipboardSigSvg("#fff")}</div>
      <div class="sig-line"></div>
      <div class="sig-name">Yard Supervisor</div>
      <div class="sig-value">${supervisorName}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="mountain-band">${mountainBandSvg("#9fc0ea")}</div>
  <div class="footer-bar">
    <span class="footer-brand">🏔 ${yardName}</span>
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
