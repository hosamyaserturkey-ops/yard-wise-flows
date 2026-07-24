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

// Imported for local use below AND re-exported so receipt callers (and
// gateOutReceipt) keep importing it from here. A bare `export … from` is only a
// re-export and does NOT create a local binding — referencing it in this module
// then throws `ISO_DESCRIPTIONS is not defined`, which aborted the receipt after
// the window opened and left a blank page.
import { ISO_DESCRIPTIONS } from "@/lib/containerTypes";
export { ISO_DESCRIPTIONS };

/** Brand palette shared by both ticket types. */
export const BLUE = "#1E50A8";
export const BLUE_DARK = "#14386F";

/** Everest brand mark — blue globe with a grey twin-peak mountain in front. */
export const everestLogoSvg = (): string => `<svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
  <defs><clipPath id="evg"><circle cx="110" cy="80" r="72"/></clipPath></defs>
  <circle cx="110" cy="80" r="72" fill="#2f74d6"/>
  <ellipse cx="86" cy="54" rx="26" ry="18" fill="#5b93e6" opacity="0.55"/>
  <g clip-path="url(#evg)" stroke="#bcd6f5" stroke-width="2.4" fill="none" opacity="0.7">
    <line x1="38" y1="80" x2="182" y2="80"/>
    <ellipse cx="110" cy="80" rx="72" ry="30"/>
    <ellipse cx="110" cy="80" rx="72" ry="58"/>
    <line x1="110" y1="8" x2="110" y2="152"/>
    <ellipse cx="110" cy="80" rx="30" ry="72"/>
    <ellipse cx="110" cy="80" rx="56" ry="72"/>
  </g>
  <path d="M16 170 L74 78 L106 122 L130 170 Z" fill="#9aa6b5"/>
  <path d="M90 170 L150 60 L210 170 Z" fill="#4b5563"/>
  <path d="M150 60 L167 86 L150 97 L136 80 Z" fill="#ffffff" opacity="0.92"/>
</svg>`;

/** Jagged mountain-silhouette decorative band for the bottom edge of the ticket. */
export const mountainBandSvg = (color: string): string => `<svg viewBox="0 0 780 44" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><polygon points="0,44 0,30 70,12 130,30 190,8 250,28 320,14 380,32 440,10 510,28 570,14 640,32 700,16 780,30 780,44" fill="${color}" opacity="0.55"/><polygon points="0,44 0,36 90,20 160,34 230,18 300,34 380,22 460,36 540,20 620,34 700,24 780,36 780,44" fill="${color}"/></svg>`;

export const truckWatermarkSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.1"><rect x="1" y="4" width="14" height="11" rx="1"/><path d="M15 8h4l3.5 3.5V15H15V8z"/><circle cx="5.5" cy="17.5" r="2.2"/><circle cx="18" cy="17.5" r="2.2"/></svg>`;

export const clipboardDollarSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.1"><path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><path d="M12 10v7M10.2 11.6h2.6a1.2 1.2 0 0 1 0 2.4h-2.6m0 0h2.9a1.2 1.2 0 0 1 0 2.4h-2.9"/></svg>`;

export const documentSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.1"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 12.5h7M8.5 15.5h7M8.5 9.5h3"/></svg>`;

export const containerSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.1"><rect x="2" y="6" width="20" height="12" rx="1"/><path d="M6 6v12M10 6v12M14 6v12M18 6v12"/></svg>`;

export const personSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>`;

export const shipSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><path d="M3 16l1.5 4h15L21 16"/><path d="M5 16l1-8h12l1 8"/><path d="M12 8V3M9 5h6"/></svg>`;

export const clipboardSigSvg = (color: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="1.6"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/></svg>`;

/** Shared ticket chrome (CSS) so gate-in and gate-out stay visually identical. */
export const receiptCss = (): string => `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #e9edf3; color: #1e293b; }
    .page { max-width: 800px; margin: 22px auto; background: #fff; border: 1px solid #d7dee8; border-radius: 20px; padding: 14px; }

    /* ── Header ── */
    .header { position: relative; border-radius: 16px; overflow: hidden; min-height: 148px; background: linear-gradient(135deg, #245cb5, ${BLUE_DARK}); }
    .header::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.10) 1.4px, transparent 1.4px); background-size: 12px 12px; opacity: .6; }
    .logo-panel { position: absolute; left: 0; top: 0; bottom: 0; width: 42%; background: #fff; clip-path: polygon(0 0, 86% 0, 100% 100%, 0 100%); display: flex; align-items: center; gap: 12px; padding: 0 26px 0 22px; z-index: 2; box-shadow: 6px 0 18px rgba(0,0,0,.12); }
    .logo-mark { width: 74px; height: 68px; flex: none; }
    .logo-word { display: flex; flex-direction: column; line-height: 1; }
    .logo-1 { font-size: 1.5rem; font-weight: 800; color: #1e40af; letter-spacing: 1px; }
    .logo-2 { font-size: 0.6rem; font-weight: 700; color: #6b7280; letter-spacing: 2.5px; margin-top: 4px; }
    .title-block { position: absolute; left: 42%; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #fff; z-index: 1; padding: 10px 132px 10px 6px; }
    .ticket-title { font-size: 1.62rem; font-weight: 800; letter-spacing: 1.2px; }
    .ticket-title-ar { font-size: 0.82rem; color: rgba(255,255,255,.78); margin-top: 3px; font-family: 'Tahoma', Arial, sans-serif; direction: rtl; }
    .header-divider { display: flex; align-items: center; gap: 8px; width: 72%; margin: 9px 0 7px; }
    .header-divider::before, .header-divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,.4); }
    .diamond { width: 7px; height: 7px; background: #fff; transform: rotate(45deg); flex: none; }
    .yard-name-header { font-size: 1rem; font-weight: 700; letter-spacing: 0.5px; }
    .header-meta { display: flex; align-items: center; gap: 12px; margin-top: 7px; font-size: 0.82rem; color: rgba(255,255,255,.85); }
    .header-meta .sep { opacity: .5; }
    .badges { position: absolute; top: 16px; right: 18px; z-index: 3; display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 104px; }
    .ticket-no { background: #fff; border-radius: 9px; padding: 5px 6px 6px; text-align: center; color: ${BLUE_DARK}; }
    .ticket-no span { display: block; font-size: 0.56rem; font-weight: 700; letter-spacing: 1px; color: #64748b; }
    .ticket-no strong { font-size: 0.98rem; letter-spacing: 0.5px; }
    .sl-badge { background: ${BLUE_DARK}; color: #fff; border: 2px solid rgba(255,255,255,.35); border-radius: 9px; padding: 8px 6px; text-align: center; font-size: 1.35rem; font-weight: 800; letter-spacing: 2px; }

    /* ── Body ── */
    .body { padding: 20px 6px 4px; }
    .section { position: relative; border: 1px solid #dbe4f0; border-radius: 15px; padding: 22px 20px 18px; margin-bottom: 15px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .wm-clip { position: absolute; inset: 0; border-radius: 15px; overflow: hidden; z-index: 0; pointer-events: none; }
    .watermark { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 150px; height: 150px; opacity: 0.06; }
    .section-pill { position: absolute; top: -13px; left: 20px; z-index: 2; display: inline-flex; align-items: center; gap: 7px; background: linear-gradient(135deg, #245cb5, ${BLUE}); color: #fff; border-radius: 999px; padding: 6px 18px 6px 14px; font-size: 0.7rem; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; box-shadow: 0 2px 6px rgba(20,56,111,.28); }
    .pill-ico { width: 15px; height: 15px; }
    .content { position: relative; z-index: 1; }

    .cinfo { display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px 26px; }
    .cinfo-left { display: flex; flex-direction: column; gap: 14px; }
    .cinfo-right { display: flex; align-items: center; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 26px; }
    .field-label { font-size: 0.64rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px; }
    .field-value { font-size: 0.95rem; font-weight: 700; color: #1e293b; }
    .field-value.mono { font-family: 'Courier New', monospace; font-size: 1.05rem; color: ${BLUE}; letter-spacing: 1px; }
    .field-value.big { font-size: 1.3rem; color: ${BLUE}; }

    /* ── Financial ── */
    .fin-note { display: flex; align-items: center; gap: 14px; }
    .fin-icon { width: 46px; height: 46px; flex: none; border-radius: 50%; background: #eef4fc; border: 1px solid #d6e2f3; display: flex; align-items: center; justify-content: center; padding: 11px; }
    .fin-note-text { font-size: 0.92rem; color: #475569; font-style: italic; }
    .money-card { background: #eff6ff; border: 1px solid #bfd6f5; border-radius: 12px; padding: 15px 18px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .money-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; color: ${BLUE}; }
    .money-ar { font-size: 0.73rem; color: #3b6bb0; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .money-amount { font-size: 1.85rem; font-weight: 800; color: ${BLUE_DARK}; margin-top: 6px; }
    .money-currency { font-size: 0.95rem; font-weight: 600; }
    .money-icon { width: 42px; height: 42px; }
    .money-breakdown { font-size: 0.79rem; color: #475569; }
    .breakdown-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .breakdown-row:last-child { border: none; }
    .breakdown-row.method { color: ${BLUE_DARK}; font-weight: 600; }

    /* ── Grade ── */
    .grade-box { border: 1px solid #dbe4f0; border-radius: 10px; padding: 12px 16px; font-size: 0.95rem; font-weight: 700; color: #1e293b; }

    /* ── Signatures ── */
    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; padding: 8px 10px 16px; }
    .sig { text-align: center; }
    .sig-avatar { width: 40px; height: 40px; border-radius: 50%; background: ${BLUE}; display: flex; align-items: center; justify-content: center; margin: 0 auto 9px; padding: 9px; }
    .sig-line { border-top: 1.5px solid #64748b; padding-top: 6px; margin-top: 22px; }
    .sig-name { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${BLUE_DARK}; }
    .sig-name-ar { font-size: 0.7rem; color: #94a3b8; direction: rtl; font-family: 'Tahoma', Arial, sans-serif; margin-top: 2px; }
    .sig-value { font-size: 0.83rem; font-weight: 600; color: #334155; margin-top: 2px; }

    /* ── Footer ── */
    .mountain-band { height: 40px; line-height: 0; margin: 0 -14px; }
    .mountain-band svg { display: block; }
    .footer-bar { background: ${BLUE_DARK}; color: rgba(255,255,255,.8); padding: 10px 22px; margin: 0 -14px -14px; border-radius: 0 0 18px 18px; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; }
    .footer-brand { font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px; }

    /* ── Print: compact so the ticket always fits one A4 page ── */
    @page { size: A4 portrait; margin: 7mm; }
    @media print {
      html { font-size: 12.5px; }
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { box-shadow: none; margin: 0; max-width: 100%; padding: 10px; border: none; }
      .header { min-height: 122px; }
      .body { padding: 16px 4px 2px; }
      .section { padding: 16px 16px 13px; margin-bottom: 11px; }
      .cinfo, .fields { gap: 10px 22px; }
      .cinfo-left { gap: 10px; }
      .money-card { padding: 10px 14px; margin-bottom: 7px; }
      .money-amount { font-size: 1.45rem; }
      .signatures { padding: 4px 8px 10px; gap: 14px; }
      .sig-line { margin-top: 18px; }
      .footer-bar { padding: 7px 20px; }
      .section, .signatures, .footer-bar, .header { break-inside: avoid; }
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
  const gateInDateRaw = new Date(containerData.gate_in_time);
  const dateStr = escapeHtml(gateInDateRaw.toLocaleDateString("en-GB"));
  const timeStr = escapeHtml(gateInDateRaw.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  const ticketNum = containerData.ticket_number != null
    ? String(containerData.ticket_number).padStart(6, "0")
    : "—";
  const yardNameRaw = profile?.yard_name || "YARD";
  const yardName = escapeHtml(yardNameRaw);
  const supervisorName = escapeHtml(profile?.full_name || profile?.username || "—");
  const printedBy = escapeHtml(profile?.username || profile?.full_name || "system");
  const printedAt = escapeHtml(new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""));
  const containerNumberSafe = escapeHtml(containerData.container_number);
  const shippingLineSafe = escapeHtml(containerData.shipping_line);
  const truckNumberSafe = escapeHtml(containerData.truck_number);
  const driverNameSafe = escapeHtml(containerData.driver_name);

  // Logo wordmark: first word large, remaining words as the sub-line.
  const words = yardNameRaw.trim().split(/\s+/);
  const logoLine1 = escapeHtml(words[0] || "YARD");
  const logoLine2 = escapeHtml(words.slice(1).join(" "));

  const isoLabel = escapeHtml(ISO_DESCRIPTIONS[containerData.container_type] || containerData.container_type);
  const gradeRaw = (inspection?.grade || "").trim().toUpperCase();
  const conditionValue = escapeHtml(gradeRaw || "—");
  const gradeText = gradeRaw ? `Grade: ${escapeHtml(gradeRaw)}` : "Not graded";

  const financialSection = demurragePayment ? `
      <div class="money-card">
        <div>
          <div class="money-label">DEMURRAGE COLLECTED</div>
          <div class="money-ar">غرامات التأخير المحصلة</div>
          <div class="money-amount">${demurragePayment.totalCollected.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span class="money-currency">JOD</span></div>
        </div>
        <div class="money-icon">${clipboardDollarSvg(BLUE)}</div>
      </div>
      <div class="money-breakdown">
        <div class="breakdown-row"><span>Demurrage (${demurragePayment.chargeableDays} day${demurragePayment.chargeableDays !== 1 ? "s" : ""})</span><span>${demurragePayment.demurrageAmount.toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
        <div class="breakdown-row"><span>Service Fee</span><span>${Number(demurragePayment.serviceFee).toLocaleString("en", { minimumFractionDigits: 3 })} JOD</span></div>
        <div class="breakdown-row method"><span>Payment Method</span><span>${demurragePayment.paymentMethod === "cash" ? "💵 Cash" : "📲 Qlick"}</span></div>
      </div>
    ` : `
      <div class="fin-note">
        <div class="fin-icon">${clipboardDollarSvg(BLUE)}</div>
        <div class="fin-note-text">No demurrage collected — within free days or already paid.</div>
      </div>
    `;

  // Open the window only once the receipt HTML above is fully built, so a
  // build-time error can never leave a blank popup on screen.
  const receiptWindow = window.open("", "_blank");
  if (!receiptWindow) return false;
  receiptWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Reception Ticket — ${containerNumberSafe}</title>
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
      <div class="ticket-title">RECEPTION TICKET</div>
      <div class="ticket-title-ar">وصل استلام حاوية</div>
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
      <div class="content cinfo">
        <div class="cinfo-left">
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
            <div class="field-label">RECEIVED AT</div>
            <div class="field-value">${yardName}</div>
          </div>
        </div>
        <div class="cinfo-right">
          <div class="field">
            <div class="field-label">CONDITION / NOTES</div>
            <div class="field-value big">${conditionValue}</div>
          </div>
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
      </div>
    </div>

    <!-- Financial Summary -->
    <div class="section">
      <div class="wm-clip"><div class="watermark">${clipboardDollarSvg(BLUE)}</div></div>
      <div class="section-pill"><span class="pill-ico">${clipboardDollarSvg("#fff")}</span> Financial Summary</div>
      <div class="content">${financialSection}</div>
    </div>

    <!-- Grade -->
    <div class="section">
      <div class="wm-clip"><div class="watermark">${documentSvg(BLUE)}</div></div>
      <div class="section-pill"><span class="pill-ico">${documentSvg("#fff")}</span> Grade</div>
      <div class="content">
        <div class="grade-box">${gradeText}</div>
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
      <div class="sig-name">Shipping Line Rep.</div>
      <div class="sig-name-ar">ممثل الخط الملاحي</div>
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
