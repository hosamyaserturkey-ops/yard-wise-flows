/**
 * APM Terminals "Empty Container Returns" — response parsing and the yard-side
 * reading of it.
 *
 * What that API actually answers: for a container number (assetId) at one
 * facility, whether the terminal currently accepts that empty back. It is not
 * a gate-event feed, so it never states outright "this box gated in at 14:20".
 * What it does give an off-dock yard is the next best thing: while the
 * terminal still lists an open empty return for a container, the container has
 * not been handed back yet; once the terminal stops listing it — or reports a
 * return/gate-in date — the empty is no longer outstanding there.
 *
 * Everything here is pure (no fetch, no DOM), so the Worker route
 * (worker/apmTerminals.ts) and the unit tests share exactly the parsing the
 * screen shows.
 */

/** How many containers one lookup may carry — enforced by the Worker route too. */
export const MAX_CONTAINERS_PER_LOOKUP = 10;

/** ISO 6346 number as it appears in a terminal payload (check digit sometimes dropped). */
const CONTAINER_VALUE = /^[A-Z]{4}[0-9]{6,7}$/;
/** Facility/terminal codes are short alphanumerics, e.g. JOAQJ, SEGOT, USLAX. */
const FACILITY_VALUE = /^[A-Z0-9]{3,12}$/;
/** Enough of a date to be worth showing: an ISO-ish or d/m/y string. */
const DATE_VALUE = /\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/;

export interface EmptyReturnRecord {
  containerNumber: string;
  facilityCode: string | null;
  shippingLine: string | null;
  containerIsoCode: string | null;
  /** Free-text status/state the terminal reported, when it carries one. */
  terminalStatus: string | null;
  /** Size/type/height as the terminal words it, e.g. "40/GP/96". */
  sizeType: string | null;
  /** The terminal's own "we accept this empty back" flag, when it carries one. */
  accepted: boolean | null;
  /** The terminal's own isContainerReturned flag, when it carries one. */
  returnedFlag: boolean | null;
  /** Start of the window in which the empty may be returned, when given. */
  openFrom: string | null;
  /** End of that window, when given. */
  openUntil: string | null;
  /** Gate-in / return timestamp at the terminal, when the payload carries one. */
  returnedAt: string | null;
  /** Human-readable note, reason or error attached to the record. */
  message: string | null;
}

/**
 * What the check means for the gate.
 * - "not_returned": the terminal still accepts the empty, so it has not gated
 *   in there. This is an inference from an open return, not a gate event.
 * - "returned": the terminal reports the empty as already back.
 * - "unknown": the terminal answered, but said nothing conclusive about it.
 * - "error": the lookup itself failed (not configured, upstream down, denied).
 */
export type TerminalCheckStatus = "not_returned" | "returned" | "unknown" | "error";

export interface TerminalCheck {
  containerNumber: string;
  status: TerminalCheckStatus;
  /** One line, in the operator's words, of what the terminal said. */
  detail: string;
  record: EmptyReturnRecord | null;
}

export const TERMINAL_CHECK_LABELS: Record<TerminalCheckStatus, string> = {
  not_returned: "Not gated in at the terminal",
  returned: "Gated in at the terminal",
  unknown: "No answer for this container",
  error: "Terminal check unavailable",
};

// ── Payload walking ────────────────────────────────────────────────────────
// The records sit under wrappers the published spec doesn't pin down, and the
// part that matters — which facility takes the empty, and when — is typically
// a list nested *under* the container rather than beside its number. So each
// object carrying a container number is treated as a root, and the whole
// subtree beneath it is read as that container's detail.

type Obj = Record<string, unknown>;

const MAX_DEPTH = 8;
const MAX_OBJECTS = 500;

const normKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const CONTAINER_NAMES = [
  "containerid", "containernumber", "containerno", "containercode",
  "assetid", "equipmentnumber", "equipmentid", "unitnumber",
];
const CONTAINER_FUZZY = /(container|asset|equipment|unit)(id|number|no|nbr|code)?$/;

const FACILITY_NAMES = [
  "facilitycode", "facilityid", "terminalcode", "terminalid",
  "depotcode", "sitecode", "facility", "terminal", "depot",
];
const FACILITY_FUZZY = /(facility|terminal|depot|site)(code|id)$/;

/**
 * Read a string field: exact key names first (so `status` wins over
 * `statusDescription`), then a looser key match, and only values that look
 * like the field (a facility code isn't the word "ACCEPTED"). Scans the
 * objects in order, so the caller decides which layer answers first.
 */
function pickString(
  objs: Obj[],
  names: string[],
  fuzzy?: RegExp,
  valueShape?: RegExp,
): string | null {
  const fits = (v: unknown): string | null => {
    if (typeof v === "number") return String(v);
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (!s) return null;
    if (valueShape && !valueShape.test(s.toUpperCase())) return null;
    return s;
  };

  for (const name of names) {
    for (const obj of objs) {
      for (const [k, v] of Object.entries(obj)) {
        if (normKey(k) !== name) continue;
        const hit = fits(v);
        if (hit) return hit;
      }
    }
  }
  if (!fuzzy) return null;
  for (const obj of objs) {
    for (const [k, v] of Object.entries(obj)) {
      if (!fuzzy.test(normKey(k))) continue;
      const hit = fits(v);
      if (hit) return hit;
    }
  }
  return null;
}

const TRUE_WORDS = /^(true|yes|y|1|accepted|accept|open|available|allowed|eligible)$/;
const FALSE_WORDS = /^(false|no|n|0|notaccepted|rejected|closed|unavailable|notallowed|ineligible)$/;

function pickBoolean(objs: Obj[], names: string[], fuzzy?: RegExp): boolean | null {
  const fits = (v: unknown): boolean | null => {
    if (typeof v === "boolean") return v;
    if (typeof v !== "string") return null;
    const s = normKey(v);
    if (TRUE_WORDS.test(s)) return true;
    if (FALSE_WORDS.test(s)) return false;
    return null;
  };

  for (const name of names) {
    for (const obj of objs) {
      for (const [k, v] of Object.entries(obj)) {
        if (normKey(k) !== name) continue;
        const hit = fits(v);
        if (hit !== null) return hit;
      }
    }
  }
  if (!fuzzy) return null;
  for (const obj of objs) {
    for (const [k, v] of Object.entries(obj)) {
      if (!fuzzy.test(normKey(k))) continue;
      const hit = fits(v);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function readContainerNumber(obj: Obj): string | null {
  const keyed = pickString([obj], CONTAINER_NAMES, CONTAINER_FUZZY, CONTAINER_VALUE);
  if (keyed) return keyed.toUpperCase();
  // Nothing else in these payloads looks like AAAA1234567, so an unkeyed
  // match is still safe as a fallback.
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && CONTAINER_VALUE.test(v.trim().toUpperCase())) {
      return v.trim().toUpperCase();
    }
  }
  return null;
}

const readFacility = (obj: Obj) =>
  pickString([obj], FACILITY_NAMES, FACILITY_FUZZY, FACILITY_VALUE);

/** Objects that carry a container number, without descending into one another. */
function collectRoots(value: unknown, out: Obj[], depth = 0): void {
  if (out.length >= MAX_OBJECTS || depth > MAX_DEPTH || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRoots(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Obj;
  if (readContainerNumber(obj)) {
    out.push(obj);
    return;
  }
  for (const nested of Object.values(obj)) collectRoots(nested, out, depth + 1);
}

/** Everything under a root that isn't itself another container's record. */
function collectDetail(value: unknown, out: Obj[], depth = 0): void {
  if (out.length >= MAX_OBJECTS || depth > MAX_DEPTH || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectDetail(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Obj;
  if (readContainerNumber(obj)) return;
  out.push(obj);
  for (const nested of Object.values(obj)) collectDetail(nested, out, depth + 1);
}

/**
 * The root first, then its detail objects — the ones for the facility we
 * asked about ahead of the rest, so a payload listing several return
 * locations is read against the one the operator queried.
 */
function scopeFor(root: Obj, preferredFacility?: string): Obj[] {
  const detail: Obj[] = [];
  for (const nested of Object.values(root)) collectDetail(nested, detail);
  if (!preferredFacility) return [root, ...detail];

  const wanted = preferredFacility.trim().toUpperCase();
  const matches = (obj: Obj) => readFacility(obj)?.toUpperCase() === wanted;
  return [root, ...detail.filter(matches), ...detail.filter((o) => !matches(o))];
}

function toRecord(containerNumber: string, scope: Obj[]): EmptyReturnRecord {
  return {
    containerNumber,
    facilityCode: pickString(scope, FACILITY_NAMES, FACILITY_FUZZY, FACILITY_VALUE),
    shippingLine: pickString(
      scope,
      ["shippingline", "shippinglinecode", "carriercode", "carrier", "linecode", "line", "scac", "operator"],
      /(shippingline|carrier|linecode|scac)$/,
    ),
    containerIsoCode: pickString(
      scope,
      ["containerisocode", "isocode", "isotype", "equipmenttype", "containertype", "sizetype", "typecode"],
      /(isocode|isotype|equipmenttype|containertype|sizetype)$/,
    ),
    terminalStatus: pickString(
      scope,
      ["status", "emptyreturnstatus", "returnstatus", "acceptancestatus", "state", "availability", "statusdescription"],
      /(status|acceptance|availability)$/,
    ),
    sizeType: pickString(
      scope,
      ["sizetypeheight", "sizetype", "sizetypecode", "equipmentsizetype"],
      /(sizetype)/,
    ),
    accepted: pickBoolean(
      scope,
      ["accepted", "isaccepted", "accept", "acceptreturn", "acceptingreturns", "allowed", "isallowed", "eligible", "returnable", "canreturn", "available"],
      /(accept|allow|eligib|returnable|canreturn)/,
    ),
    // ACT Aqaba answers with isContainerReturned: "false" — the terminal's
    // own word on whether the empty is back, separate from any status text.
    returnedFlag: pickBoolean(
      scope,
      ["iscontainerreturned", "containerreturned", "isreturned", "returned", "hasbeenreturned"],
      /(isreturned|containerreturned|hasbeenreturned)$/,
    ),
    openFrom: pickString(
      scope,
      ["validfrom", "startdate", "effectivefrom", "openfrom", "returnfrom", "fromdate", "datefrom"],
      /(validfrom|startdate|effectivefrom|openfrom|returnfrom|fromdate|datefrom)$/,
      DATE_VALUE,
    ),
    openUntil: pickString(
      scope,
      ["validto", "validuntil", "enddate", "effectiveto", "openuntil", "returnuntil", "todate", "dateto", "expirydate"],
      /(validto|validuntil|enddate|effectiveto|openuntil|returnuntil|todate|dateto|expiry)$/,
      DATE_VALUE,
    ),
    returnedAt: pickString(
      scope,
      ["gateindatetimelocal", "gateindatetime", "gateindate", "gateintime", "gatedindate", "returndate", "returneddate", "actualreturndate", "receiveddate", "ingatedate"],
      // Not anchored: the live keys carry suffixes (gateInDateTimeLocal), and
      // the date-shaped value is what keeps a flag like isContainerReturned
      // out of this field.
      /(gatein|gatedin|ingate|returndate|returneddate|receiveddate|actualreturn)/,
      DATE_VALUE,
    ),
    message: pickString(
      scope,
      ["message", "reason", "description", "note", "notes", "comment", "errormessage", "detail", "details"],
      /(message|reason|description|note|comment|detail)s?$/,
    ),
  };
}

/**
 * Every container the payload carries, first mention of each number wins.
 * `preferredFacility` is the facility the lookup asked about; when the
 * response lists several, that one's detail is read first.
 */
export function normalizeEmptyReturns(
  payload: unknown,
  preferredFacility?: string,
): EmptyReturnRecord[] {
  const roots: Obj[] = [];
  collectRoots(payload, roots);

  // One container can appear as several roots (a summary plus a detail
  // block); read them as one scope so neither half is lost.
  const scopes = new Map<string, Obj[]>();
  for (const root of roots) {
    const containerNumber = readContainerNumber(root)!;
    const scope = scopeFor(root, preferredFacility);
    const existing = scopes.get(containerNumber);
    scopes.set(containerNumber, existing ? [...existing, ...scope] : scope);
  }

  return [...scopes].map(([containerNumber, scope]) => toRecord(containerNumber, scope));
}

/**
 * Split a typed or pasted list of container numbers. Operators paste from a
 * manifest, so commas, spaces and new lines all separate.
 */
export function parseContainerNumbers(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

const RETURNED_WORDS = /returned|gated ?in|gate ?in|received|in ?gate|delivered|dropped ?off|on ?terminal|in ?depot/i;
const OPEN_WORDS = /accept|open|available|allowed|eligible|due|outstanding|expected/i;
const NOT_FOUND_WORDS = /not found|no (details|record|data)|unknown (asset|container)/i;

/**
 * "2026-08-28T01:23:53+03:00" reads badly at a gate desk. Trim it to the
 * minute and drop the T; anything that isn't an ISO timestamp is left alone.
 */
export function formatTerminalTime(value: string): string {
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return iso ? `${iso[1]} ${iso[2]}` : value;
}

/** Read one container's records the way the gate needs to read them. */
export function deriveTerminalCheck(
  containerNumber: string,
  records: EmptyReturnRecord[],
): TerminalCheck {
  const wanted = containerNumber.trim().toUpperCase();
  const record = records.find((r) => r.containerNumber === wanted) ?? null;

  if (!record) {
    return {
      containerNumber: wanted,
      status: "unknown",
      detail:
        "The terminal returned no empty-return record for this container. It may already be back, or the facility may not handle this box.",
      record: null,
    };
  }

  const at = record.facilityCode ? ` at ${record.facilityCode}` : "";

  // A gate-in timestamp is the strongest thing this API gives: the box went
  // through that terminal's gate at that moment. It outranks every flag —
  // including a return the terminal has not finished booking in.
  if (record.returnedAt) {
    const pending =
      record.returnedFlag === false
        ? " The terminal has not marked the empty return itself as complete."
        : "";
    return {
      containerNumber: wanted,
      status: "returned",
      detail: `Terminal recorded a gate-in${at} on ${formatTerminalTime(record.returnedAt)} terminal local time.${pending}`,
      record,
    };
  }
  if (record.returnedFlag === true) {
    return {
      containerNumber: wanted,
      status: "returned",
      detail: `Terminal reports this empty as returned${at}.`,
      record,
    };
  }
  if (record.terminalStatus && RETURNED_WORDS.test(record.terminalStatus)) {
    return {
      containerNumber: wanted,
      status: "returned",
      detail: `Terminal reports this empty as "${record.terminalStatus}"${at}.`,
      record,
    };
  }
  if (record.accepted === true || (record.terminalStatus && OPEN_WORDS.test(record.terminalStatus))) {
    return {
      containerNumber: wanted,
      status: "not_returned",
      detail: `Terminal still accepts this empty for return${at}, so it has not been handed back yet.`,
      record,
    };
  }
  // A return window is the acceptance, stated as dates rather than a flag:
  // the terminal only publishes one for an empty it is still expecting.
  if (record.openFrom || record.openUntil) {
    const window = record.openFrom && record.openUntil
      ? `${record.openFrom} to ${record.openUntil}`
      : record.openFrom
        ? `from ${record.openFrom}`
        : `until ${record.openUntil}`;
    return {
      containerNumber: wanted,
      status: "not_returned",
      detail: `Terminal lists an open return window${at} (${window}), so this empty has not been handed back yet.`,
      record,
    };
  }
  // No gate-in on record and the terminal says the empty isn't back: it is
  // still out with the merchant.
  if (record.returnedFlag === false) {
    return {
      containerNumber: wanted,
      status: "not_returned",
      detail: `Terminal has no gate-in on record${at} and reports this empty as not yet returned.`,
      record,
    };
  }
  if (record.message && NOT_FOUND_WORDS.test(record.message)) {
    return {
      containerNumber: wanted,
      status: "unknown",
      detail: `The terminal has no record of this container${at} — "${record.message}". Check the number, or the container may belong to another facility.`,
      record,
    };
  }
  if (record.accepted === false) {
    return {
      containerNumber: wanted,
      status: "unknown",
      detail: `Terminal is not accepting this empty${at}${record.message ? ` — ${record.message}` : ""}. That is a return restriction, not a gate-in record.`,
      record,
    };
  }
  return {
    containerNumber: wanted,
    status: "unknown",
    detail: record.message
      ? `Terminal answered without a return status — ${record.message}`
      : "Terminal answered without a return status for this container. Open the raw response below to see everything it sent.",
    record,
  };
}
