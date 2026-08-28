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
/** Facility/terminal codes are short alphanumerics, e.g. SEGOT, USLAX. */
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
  /** The terminal's own "we accept this empty back" flag, when it carries one. */
  accepted: boolean | null;
  /** Return / gate-in timestamp, when the payload carries one. */
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
// The published spec leaves room for the records to sit under different
// wrappers ("containers", "emptyReturns", a bare array…), so rather than
// pinning one shape we walk the whole payload and read every object that
// carries a container number.

type Obj = Record<string, unknown>;

const MAX_DEPTH = 8;
const MAX_OBJECTS = 500;

function collectObjects(value: unknown, out: Obj[], depth = 0): void {
  if (out.length >= MAX_OBJECTS || depth > MAX_DEPTH || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  out.push(value as Obj);
  for (const nested of Object.values(value as Obj)) {
    collectObjects(nested, out, depth + 1);
  }
}

const normKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Read a string field: exact key names first (so `status` wins over
 * `statusDescription`), then a looser key match, and only values that look
 * like the field (a facility code isn't the word "ACCEPTED").
 */
function pickString(
  obj: Obj,
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
    for (const [k, v] of Object.entries(obj)) {
      if (normKey(k) !== name) continue;
      const hit = fits(v);
      if (hit) return hit;
    }
  }
  if (!fuzzy) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (!fuzzy.test(normKey(k))) continue;
    const hit = fits(v);
    if (hit) return hit;
  }
  return null;
}

const TRUE_WORDS = /^(true|yes|y|1|accepted|accept|open|available|allowed|eligible)$/;
const FALSE_WORDS = /^(false|no|n|0|notaccepted|rejected|closed|unavailable|notallowed|ineligible)$/;

function pickBoolean(obj: Obj, names: string[], fuzzy?: RegExp): boolean | null {
  const fits = (v: unknown): boolean | null => {
    if (typeof v === "boolean") return v;
    if (typeof v !== "string") return null;
    const s = normKey(v);
    if (TRUE_WORDS.test(s)) return true;
    if (FALSE_WORDS.test(s)) return false;
    return null;
  };

  for (const name of names) {
    for (const [k, v] of Object.entries(obj)) {
      if (normKey(k) !== name) continue;
      const hit = fits(v);
      if (hit !== null) return hit;
    }
  }
  if (!fuzzy) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (!fuzzy.test(normKey(k))) continue;
    const hit = fits(v);
    if (hit !== null) return hit;
  }
  return null;
}

function readContainerNumber(obj: Obj): string | null {
  const keyed = pickString(
    obj,
    ["containerid", "containernumber", "containerno", "containercode", "assetid", "equipmentnumber", "equipmentid", "unitnumber"],
    /(container|asset|equipment|unit)(id|number|no|nbr|code)?$/,
    CONTAINER_VALUE,
  );
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

function toRecord(obj: Obj): EmptyReturnRecord | null {
  const containerNumber = readContainerNumber(obj);
  if (!containerNumber) return null;
  return {
    containerNumber,
    facilityCode: pickString(
      obj,
      ["facilitycode", "facilityid", "terminalcode", "terminalid", "depotcode", "sitecode", "facility", "terminal", "depot"],
      /(facility|terminal|depot|site)(code|id)$/,
      FACILITY_VALUE,
    ),
    shippingLine: pickString(
      obj,
      ["shippingline", "shippinglinecode", "carriercode", "carrier", "linecode", "line", "scac", "operator"],
      /(shippingline|carrier|linecode|scac)$/,
    ),
    containerIsoCode: pickString(
      obj,
      ["containerisocode", "isocode", "isotype", "equipmenttype", "containertype", "sizetype", "typecode"],
      /(isocode|isotype|equipmenttype|containertype|sizetype)$/,
    ),
    terminalStatus: pickString(
      obj,
      ["status", "emptyreturnstatus", "returnstatus", "acceptancestatus", "state", "availability"],
      /(status|acceptance|availability)$/,
    ),
    accepted: pickBoolean(
      obj,
      ["accepted", "isaccepted", "accept", "acceptreturn", "acceptingreturns", "allowed", "isallowed", "eligible", "returnable", "canreturn", "available"],
      /(accept|allow|eligib|returnable|canreturn)/,
    ),
    returnedAt: pickString(
      obj,
      ["gateindate", "gateintime", "gatedindate", "returndate", "returneddate", "actualreturndate", "receiveddate", "ingatedate"],
      /(gatein|gatedin|returned|returndate|ingate|received)(date|time|at)?$/,
      DATE_VALUE,
    ),
    message: pickString(
      obj,
      ["message", "reason", "description", "note", "notes", "comment", "errormessage", "detail", "details"],
      /(message|reason|description|note|comment|detail)s?$/,
    ),
  };
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

/** Every container record the payload carries, first mention of each number wins. */
export function normalizeEmptyReturns(payload: unknown): EmptyReturnRecord[] {
  const objects: Obj[] = [];
  collectObjects(payload, objects);

  const byContainer = new Map<string, EmptyReturnRecord>();
  for (const obj of objects) {
    const record = toRecord(obj);
    if (!record) continue;
    const existing = byContainer.get(record.containerNumber);
    if (!existing) {
      byContainer.set(record.containerNumber, record);
      continue;
    }
    // Nested wrappers repeat the number with different halves of the detail;
    // keep the first non-null value seen for each field.
    byContainer.set(record.containerNumber, {
      containerNumber: existing.containerNumber,
      facilityCode: existing.facilityCode ?? record.facilityCode,
      shippingLine: existing.shippingLine ?? record.shippingLine,
      containerIsoCode: existing.containerIsoCode ?? record.containerIsoCode,
      terminalStatus: existing.terminalStatus ?? record.terminalStatus,
      accepted: existing.accepted ?? record.accepted,
      returnedAt: existing.returnedAt ?? record.returnedAt,
      message: existing.message ?? record.message,
    });
  }
  return [...byContainer.values()];
}

const RETURNED_WORDS = /returned|gated ?in|gate ?in|received|in ?gate|delivered|dropped ?off|on ?terminal|in ?depot/i;
const OPEN_WORDS = /accept|open|available|allowed|eligible|due|outstanding|expected/i;

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

  if (record.returnedAt) {
    return {
      containerNumber: wanted,
      status: "returned",
      detail: `Terminal reports this empty back${at} on ${record.returnedAt}.`,
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
      : "Terminal answered without a return status for this container.",
    record,
  };
}
