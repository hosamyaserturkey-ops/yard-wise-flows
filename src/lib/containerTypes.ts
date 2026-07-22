// Single source of truth for the ISO 6346 container type-group codes offered
// across the app — the gate-in form, the reports filter, form validation, and
// the printed receipts all derive from this list, so they can never drift.
//
// Codes follow ISO 6346 group notation: GP = General Purpose (standard dry),
// HC = High Cube, RF = Reefer, RH = Reefer High Cube, FR = Flat Rack,
// OT = Open Top, TK = Tank.

export interface ContainerTypeOption {
  /** Stored value, e.g. "40HC". */
  code: string;
  /** Dropdown label, e.g. "40HC — 40ft High Cube". */
  label: string;
  /** Full description printed on receipts. */
  description: string;
}

export const CONTAINER_TYPES: ContainerTypeOption[] = [
  { code: "20FR", label: "20FR — 20ft Flat Rack",       description: "20FR — 20ft Flat Rack container" },
  { code: "20GP", label: "20GP — 20ft Standard",        description: "20GP — 20ft Standard dry container" },
  { code: "20OT", label: "20OT — 20ft Open Top",        description: "20OT — 20ft Open Top container" },
  { code: "20RF", label: "20RF — 20ft Reefer",          description: "20RF — 20ft Reefer container" },
  { code: "20TK", label: "20TK — 20ft Tank",            description: "20TK — 20ft Tank container" },
  { code: "40FR", label: "40FR — 40ft Flat Rack",       description: "40FR — 40ft Flat Rack container" },
  { code: "40GP", label: "40GP — 40ft Standard",        description: "40GP — 40ft Standard dry container" },
  { code: "40HC", label: "40HC — 40ft High Cube",       description: "40HC — 40ft High Cube dry container" },
  { code: "40OT", label: "40OT — 40ft Open Top",        description: "40OT — 40ft Open Top container" },
  { code: "40RF", label: "40RF — 40ft Reefer",          description: "40RF — 40ft Reefer container" },
  { code: "40RH", label: "40RH — 40ft Reefer High Cube", description: "40RH — 40ft Reefer High Cube container" },
  { code: "40TK", label: "40TK — 40ft Tank",            description: "40TK — 40ft Tank container" },
  { code: "45HC", label: "45HC — 45ft High Cube",       description: "45HC — 45ft High Cube dry container" },
];

/**
 * Legacy codes from before the ISO-code correction. Kept so any pre-existing
 * records still render a friendly description on receipts and reports. Not
 * offered in the dropdowns anymore, but still accepted by validation.
 */
export const LEGACY_TYPE_DESCRIPTIONS: Record<string, string> = {
  "20FT": "20FT — 20ft Standard dry container",
  "40FT": "40FT — 40ft Standard dry container",
  "45FT": "45FT — 45ft High Cube dry container",
};

/** All codes offered in the dropdowns (current ISO codes only). */
export const CONTAINER_TYPE_CODES = CONTAINER_TYPES.map((t) => t.code);

/** Every code accepted by validation — current codes plus legacy ones. */
export const ALL_ACCEPTED_TYPE_CODES = [
  ...CONTAINER_TYPE_CODES,
  ...Object.keys(LEGACY_TYPE_DESCRIPTIONS),
];

/** code → full receipt description, covering current and legacy codes. */
export const ISO_DESCRIPTIONS: Record<string, string> = {
  ...LEGACY_TYPE_DESCRIPTIONS,
  ...Object.fromEntries(CONTAINER_TYPES.map((t) => [t.code, t.description])),
};
