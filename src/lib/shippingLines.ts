// Central list of supported shipping lines used across the app.
export const SHIPPING_LINES = [
  "SLG",
  "SLD",
  "SFS",
  
  "MDK",
  "INX",
  "ICR",
  "EMK",
  "BLT",
  "AXL",
  "XSL",
  "TRL",
] as const;

export type ShippingLine = (typeof SHIPPING_LINES)[number];
