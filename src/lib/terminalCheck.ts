import { supabase } from "@/integrations/supabase/client";
import {
  deriveTerminalCheck,
  type EmptyReturnRecord,
  type TerminalCheck,
} from "@/lib/emptyReturns";

/**
 * Browser side of the APM Terminals empty-return check. The call goes to the
 * Worker route (/api/terminal/empty-returns, see worker/index.ts), never
 * straight to APM: the API credentials stay on the server and the terminal's
 * CORS policy stops being our problem.
 */

const FACILITY_STORAGE_KEY = "terminal-check.facility";

/** Last facility the operator checked against, so they type it once per device. */
export function getPreferredFacility(): string {
  try {
    return localStorage.getItem(FACILITY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPreferredFacility(code: string): void {
  try {
    localStorage.setItem(FACILITY_STORAGE_KEY, code.trim().toUpperCase());
  } catch {
    /* private mode / storage disabled — the field just won't be remembered */
  }
}

export interface TerminalLookup {
  /** Facility actually queried (the Worker fills in its default when blank). */
  facilityCode: string;
  checkedAt: string;
  checks: TerminalCheck[];
  /** Set when the lookup itself failed; every check then reads "error". */
  error: string | null;
}

function failed(
  containerNumbers: string[],
  facilityCode: string,
  message: string,
): TerminalLookup {
  return {
    facilityCode,
    checkedAt: new Date().toISOString(),
    checks: containerNumbers.map((containerNumber) => ({
      containerNumber,
      status: "error" as const,
      detail: message,
      record: null,
    })),
    error: message,
  };
}

/**
 * Ask the terminal about one or more containers. Never throws — a failure
 * comes back as an "error" check so the gate screen can show the reason.
 */
export async function checkTerminalReturns(
  containerNumbers: string[],
  facilityCode: string,
): Promise<TerminalLookup> {
  const wanted = containerNumbers.map((c) => c.trim().toUpperCase()).filter(Boolean);
  const facility = facilityCode.trim().toUpperCase();
  if (wanted.length === 0) {
    return failed([], facility, "No container number to check");
  }

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return failed(wanted, facility, "Not authenticated");

  const params = new URLSearchParams({ assetId: wanted.join(",") });
  if (facility) params.set("facilityCode", facility);

  let res: Response;
  try {
    res = await fetch(`/api/terminal/empty-returns?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return failed(wanted, facility, "Could not reach the terminal lookup service");
  }

  // A deployment without the Worker route answers with the SPA's index.html
  // rather than JSON; treat that as "not configured" instead of crashing on
  // the parse.
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return failed(
      wanted,
      facility,
      "Terminal lookup is not available on this deployment",
    );
  }

  const body = (await res.json()) as {
    facilityCode?: string;
    checkedAt?: string;
    records?: EmptyReturnRecord[];
    error?: string;
  };
  if (!res.ok || body.error) {
    return failed(wanted, facility, body.error ?? `Terminal lookup failed (${res.status})`);
  }

  const records = body.records ?? [];
  return {
    facilityCode: body.facilityCode ?? facility,
    checkedAt: body.checkedAt ?? new Date().toISOString(),
    checks: wanted.map((containerNumber) => deriveTerminalCheck(containerNumber, records)),
    error: null,
  };
}
