// ---------------------------------------------------------------------------
// Pre-flight access checks for the paths a job will read from and write to.
//
// Jobs are dispatched to HPC and fail minutes later, long after the user has
// moved on, so a mistyped path or a directory they cannot read is much cheaper
// to catch here than in the job's logs. These checks use the same direct-to-Tapis
// + X-Tapis-Token pattern as the rest of the app's client-side calls, so they
// authenticate exactly as the browsing UI does.
// ---------------------------------------------------------------------------

import { getTapisBaseURL, sanitizePath } from "./utils";

/** Why a path could not be used, or `ok` when it can. */
export type PathAccess =
   | { ok: true }
   | { ok: false; reason: "missing" | "forbidden" | "error"; status?: number; detail?: string };

export interface PathCheck {
   /** Shown to the user, e.g. "Source Image Directory". */
   label: string;
   path: string;
   /**
    * Output directories are allowed not to exist yet — the job creates them.
    * A directory that exists but is unreadable still fails, since that is a
    * permission problem the job will hit too.
    */
   allowMissing?: boolean;
}

const encodeTapisPath = (path: string): string =>
   path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

/**
 * Asks Tapis whether one path is reachable. A `limit=1` listing is the cheapest
 * call that distinguishes "not there" from "not yours": Tapis answers 404 for a
 * path that does not exist and 403 for one the user may not read.
 */
export async function checkTapisPath(
   system: string,
   path: string,
   token: string,
): Promise<PathAccess> {
   const clean = sanitizePath(path ?? "");
   if (!clean) return { ok: false, reason: "missing", detail: "No path given" };

   const url = `${getTapisBaseURL()}/v3/files/ops/${system}/${encodeTapisPath(clean)}?offset=0&limit=1`;
   let response: Response;
   try {
      response = await fetch(url, { headers: { "X-Tapis-Token": token } });
   } catch (e) {
      // Network-level failure. Reported as "error" rather than a refusal, so the
      // caller can let the user proceed instead of blocking on our own outage.
      return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
   }

   if (response.ok) return { ok: true };
   if (response.status === 404) return { ok: false, reason: "missing", status: 404 };
   if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "forbidden", status: response.status, detail: await readDetail(response) };
   }
   return { ok: false, reason: "error", status: response.status, detail: await readDetail(response) };
}

async function readDetail(response: Response): Promise<string | undefined> {
   try {
      const text = await response.text();
      if (!text) return undefined;
      try {
         const body = JSON.parse(text);
         const detail = body?.message ?? body?.description ?? body?.detail ?? body?.error;
         return typeof detail === "string" ? detail : undefined;
      } catch {
         return text.slice(0, 300);
      }
   } catch {
      return undefined;
   }
}

/**
 * Checks every path a job needs and builds one message listing what is wrong.
 * Returns null when everything is usable, so callers read as
 * `const problem = await verifyJobPaths(...); if (problem) { alert(problem); return; }`.
 *
 * A check that fails because Tapis itself could not be reached is deliberately
 * NOT treated as a refusal — blocking a submission on our own connectivity would
 * be worse than letting the job try.
 */
export async function verifyJobPaths(
   system: string,
   checks: PathCheck[],
   token: string,
): Promise<string | null> {
   const wanted = checks.filter((c) => c.path?.trim());
   if (wanted.length === 0) return null;

   const results = await Promise.all(
      wanted.map(async (check) => ({ check, access: await checkTapisPath(system, check.path, token) })),
   );

   const problems: string[] = [];
   for (const { check, access } of results) {
      if (access.ok) continue;
      if (access.reason === "error") {
         // Could not determine — say nothing and let the submission proceed.
         console.warn(`Could not verify ${check.label} (${check.path}):`, access);
         continue;
      }
      if (access.reason === "missing") {
         if (check.allowMissing) continue;
         problems.push(`• ${check.label} does not exist:\n      ${check.path}`);
         continue;
      }
      problems.push(
         `• You do not have access to ${check.label}:\n      ${check.path}` +
            (access.detail ? `\n      (${access.detail})` : ""),
      );
   }

   if (problems.length === 0) return null;
   return (
      `The job was not submitted — these paths cannot be used on ${system}:\n\n` +
      `${problems.join("\n\n")}\n\n` +
      `Use the Browse button next to each field to pick a path you have access to.`
   );
}
