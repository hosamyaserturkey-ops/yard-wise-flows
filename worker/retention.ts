// The daily car-lot retention job (see supabase/migrations/20261115000000_car_lot_retention.sql).
//
// Postgres decides everything: which visits are old enough, that nothing is
// deleted during the first week or while a car is on hold, and how many per
// run. This job only (1) asks it to run, (2) deletes the photo FILES it hands
// back from R2, and (3) confirms which files it deleted. A file that fails to
// delete stays queued in the database and is handed out again next run.

export interface RetentionEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  RETENTION_TOKEN?: string;
  /** "report" (default) lists what would be deleted; "delete" really deletes. */
  RETENTION_MODE?: string;
  VEHICLE_PHOTOS_BUCKET: { delete(keys: string | string[]): Promise<void> };
}

export interface RetentionResult {
  ran: boolean;
  mode?: string;
  candidates?: number;
  deletedVisits?: number;
  filesDeleted?: number;
  filesFailed?: number;
  reason?: string;
}

const FILE_CHUNK = 100;

async function rpc<T>(env: RetentionEnv, name: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function runRetention(env: RetentionEnv): Promise<RetentionResult> {
  const token = env.RETENTION_TOKEN;
  if (!token) return { ran: false, reason: "RETENTION_TOKEN is not set" };
  // Anything but exactly "delete" only reports: a typo can never delete.
  const dryRun = env.RETENTION_MODE !== "delete";

  const run = await rpc<{ mode: string; candidates: number; deleted_visits: number; files: string[] }>(
    env, "car_lot_retention_run", { _token: token, _dry_run: dryRun },
  );

  // Files of visits already deleted from the database (this run or an earlier one).
  let filesDeleted = 0;
  let filesFailed = 0;
  for (let i = 0; i < run.files.length; i += FILE_CHUNK) {
    const chunk = run.files.slice(i, i + FILE_CHUNK);
    try {
      await env.VEHICLE_PHOTOS_BUCKET.delete(chunk);
    } catch (e) {
      // Not confirmed, so the database keeps them queued and hands them out again.
      filesFailed += chunk.length;
      console.error("retention: could not delete files from R2:", e instanceof Error ? e.message : e);
      continue;
    }
    await rpc<number>(env, "car_lot_retention_ack", { _token: token, _keys: chunk });
    filesDeleted += chunk.length;
  }

  const result: RetentionResult = {
    ran: true, mode: run.mode, candidates: run.candidates, deletedVisits: run.deleted_visits, filesDeleted, filesFailed,
  };
  console.log("retention:", JSON.stringify(result));
  return result;
}
