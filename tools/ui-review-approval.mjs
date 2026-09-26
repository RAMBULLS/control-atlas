#!/usr/bin/env node
// Whether the owner has approved the exact commit a pull request currently
// points at.
//
// The label is the owner's UX. It is not the integrity boundary. Removing
// `visual-approved` when the head moves depends on the synchronize run winning
// a race against whatever else is happening on the pull request, and a label
// that survives that race would otherwise approve a commit nobody looked at.
//
// The boundary is a check run recorded against one commit SHA. GitHub attaches
// a check run to the commit it was created for, so a record made for commit A
// simply does not exist on commit B. A new push therefore fails immediately and
// by construction, whatever the label says.
//
// The logic lives here rather than in workflow YAML so it can be tested. The
// workflow is a thin shell that gathers facts and calls these functions.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The name of the check run that records an approval. */
export const APPROVAL_RECORD_NAME = "owner-visual-approval-record";
/** The label the owner applies. Revocable convenience, not the boundary. */
export const APPROVAL_LABEL = "visual-approved";
/** Only a repository administrator can approve public UI. */
const APPROVING_PERMISSION = "admin";

function isBotActor(actor) {
  if (!actor) return true;
  const login = String(actor.login || "");
  if (!login) return true;
  if (String(actor.type || "").toLowerCase() === "bot") return true;
  // "github-actions[bot]", "dependabot[bot]", and anything else wearing the
  // suffix. A workflow holding GITHUB_TOKEN posts as one of these.
  return /\[bot\]$/i.test(login) || login === "github-actions";
}

/**
 * May this actor's label application create an approval record?
 *
 * @param {{login?: string, type?: string}} actor who applied the label
 * @param {string} permission that actor's repository permission
 * @returns {{allowed: boolean, reason: string}}
 */
export function canRecordApproval(actor, permission) {
  if (isBotActor(actor)) {
    return { allowed: false, reason: `approval-from-bot:${actor?.login || "unknown"}` };
  }
  if (permission !== APPROVING_PERMISSION) {
    return { allowed: false, reason: `approver-permission:${permission || "none"}` };
  }
  return { allowed: true, reason: `approved-by:${actor.login}` };
}

/**
 * Is there a usable approval record for this exact commit?
 *
 * A record counts only when it is for this head SHA, succeeded, and was created
 * by the GitHub Actions app — which, on a pull_request_target run, means it was
 * created by the workflow on the base branch. A record left over from an
 * earlier commit is not a record for this one.
 *
 * @param {Array<object>} checkRuns check runs reported for the head SHA
 * @param {string} headSha the pull request's current head
 */
export function findApprovalRecord(checkRuns, headSha) {
  const candidates = (checkRuns || []).filter((run) =>
    run
    && run.name === APPROVAL_RECORD_NAME
    && run.conclusion === "success"
    && String(run.head_sha || "") === headSha
    && String(run.app?.slug || "") === "github-actions");
  if (candidates.length === 0) return null;
  // Most recently completed wins; they are equivalent by construction.
  return candidates.sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")))[0];
}

/**
 * The gate's verdict.
 *
 * @param {object} input
 * @param {boolean} input.requiresReview did the change touch a public route
 * @param {string} input.headSha the commit the pull request points at now
 * @param {boolean} input.hasLabel is `visual-approved` currently applied
 * @param {Array<object>} input.checkRuns check runs reported for headSha
 * @returns {{approved: boolean, reason: string, detail: string}}
 */
export function approvalDecision({ requiresReview, headSha, hasLabel, checkRuns }) {
  if (!requiresReview) {
    return { approved: true, reason: "no-public-ui-change", detail: "No public route is affected." };
  }
  if (!headSha) {
    return { approved: false, reason: "no-head-sha", detail: "The pull request head could not be resolved." };
  }

  const record = findApprovalRecord(checkRuns, headSha);
  if (!record) {
    // Distinguish "never approved" from "approved, then moved on", because the
    // second one is the case people find confusing.
    const stale = (checkRuns || []).some((run) => run?.name === APPROVAL_RECORD_NAME);
    return {
      approved: false,
      reason: stale ? "approval-is-for-another-commit" : "not-approved",
      detail: stale
        ? `No approval recorded for ${headSha}. An approval exists for a different commit and does not carry over.`
        : `No approval recorded for ${headSha}.`,
    };
  }
  // The label stays a revocable switch: withdrawing it withdraws approval even
  // though the record for that commit still exists.
  if (!hasLabel) {
    return {
      approved: false,
      reason: "approval-withdrawn",
      detail: `An approval was recorded for ${headSha} but the ${APPROVAL_LABEL} label has been removed.`,
    };
  }
  return {
    approved: true,
    reason: "approved-for-this-head",
    detail: `${record.output?.title || "Approved"} for ${headSha}.`,
  };
}

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function emit(pairs) {
  process.stdout.write(`${Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}

/**
 * Two shapes, both reading JSON from files so no shell quoting is involved:
 *   --decide   --head <sha> --label <true|false> --requires-review <true|false> --check-runs <file>
 *   --can-record --actor <file> --permission <perm>
 */
function runCli() {
  if (process.argv.includes("--can-record")) {
    const actor = JSON.parse(readFileSync(argumentValue("--actor"), "utf8"));
    const verdict = canRecordApproval(actor, argumentValue("--permission"));
    emit({ can_record: verdict.allowed, record_reason: verdict.reason });
    return;
  }
  const checkRunsFile = argumentValue("--check-runs");
  const payload = checkRunsFile ? JSON.parse(readFileSync(checkRunsFile, "utf8")) : { check_runs: [] };
  const verdict = approvalDecision({
    requiresReview: argumentValue("--requires-review") === "true",
    headSha: argumentValue("--head"),
    hasLabel: argumentValue("--label") === "true",
    checkRuns: payload.check_runs || payload,
  });
  emit({ approved: verdict.approved, approval_reason: verdict.reason });
  process.stderr.write(`${verdict.detail}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runCli();
