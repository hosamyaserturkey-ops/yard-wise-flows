/**
 * Prints slot labels and car tags into a window opened at the click: draws the
 * QR codes (the drawing library loads only now), then writes the page, which
 * prints itself.
 */
import { buildCarTagHtml, buildSlotLabelsHtml, writePage, type CarTagData, type LabelSize, type SlotLabel } from "@/lib/lotPrint";
import { carTagText, slotQrText, SLOT_KIND_LABEL, type LotSlot } from "@/lib/lotSlots";
import { qrSvg } from "@/lib/qr";

export async function printSlotLabels(win: Window, slots: LotSlot[], size: LabelSize, yardName: string): Promise<void> {
  const labels: SlotLabel[] = await Promise.all(slots.map(async (s) => ({
    code: s.code,
    zone: s.zone,
    row: s.row_label,
    slot: s.slot,
    note: s.kind === "storage" ? null : SLOT_KIND_LABEL[s.kind],
    qrSvg: await qrSvg(slotQrText(s.id)),
  })));
  writePage(win, buildSlotLabelsHtml(labels, size, yardName));
}

export async function printCarTag(win: Window, tag: Omit<CarTagData, "qrSvg">, printedBy: string): Promise<void> {
  writePage(win, buildCarTagHtml({ ...tag, qrSvg: await qrSvg(carTagText(tag.vin)) }, printedBy, new Date()));
}
