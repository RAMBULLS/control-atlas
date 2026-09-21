import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE_REFRESH_CONTRACT_PATH = join(ROOT, 'data', 'source-refresh-contract.json');

export function loadSourceRefreshContract(path = SOURCE_REFRESH_CONTRACT_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export const PARTIAL_POLICIES = ['all_or_nothing', 'retain_optional_last_good'];

function validateGovernedFields(mapping, tiers, errors) {
  const id = mapping.task_id;
  const nonEmptyStrings = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());
  if (!Object.hasOwn(tiers, mapping.check_tier)) errors.push(`source refresh task ${id} has unsupported check tier ${mapping.check_tier}`);
  if (!nonEmptyStrings(mapping.required_artifacts)) errors.push(`source refresh task ${id} must name its required artifacts`);
  if (!Array.isArray(mapping.optional_artifacts)) errors.push(`source refresh task ${id} must list optional artifacts, even if none`);
  if (typeof mapping.identity_key !== 'string' || !mapping.identity_key.trim()) errors.push(`source refresh task ${id} has no stable identity key`);
  // An empty list is an explicit statement that no publisher version or lifecycle is recorded.
  for (const field of ['version_fields', 'lifecycle_fields']) {
    if (!Array.isArray(mapping[field])) errors.push(`source refresh task ${id} must declare ${field}, even if empty`);
  }
  if (typeof mapping.expected_change !== 'string' || !mapping.expected_change.trim()) errors.push(`source refresh task ${id} has no expected-change policy`);
  if (!nonEmptyStrings(mapping.downstream)) errors.push(`source refresh task ${id} must name the downstream artifacts it affects`);
  if (!PARTIAL_POLICIES.includes(mapping.partial_policy)) errors.push(`source refresh task ${id} has unsupported partial policy ${mapping.partial_policy}`);
  // Partial acceptance is only safe where an optional artifact can keep its last accepted contribution.
  if (mapping.partial_policy === 'retain_optional_last_good' &&
      (!nonEmptyStrings(mapping.optional_artifacts) || !mapping.partial_rule)) {
    errors.push(`source refresh task ${id} retains last-good optional artifacts but does not name them and the rule`);
  }
  if (mapping.partial_policy === 'all_or_nothing' && mapping.optional_artifacts?.length) {
    errors.push(`source refresh task ${id} lists optional artifacts but requires all of them`);
  }
}

export function validateSourceRefreshContract(contract, ingestionTasks, workflowText, sourceRegistry = null) {
  const errors = [];
  const mappings = Array.isArray(contract?.tasks) ? contract.tasks : [];
  const mappingById = new Map();
  const cadence = contract?.schedule?.cadence;
  const catalogIds = new Set(
    (sourceRegistry?.catalog_source_bundles || []).map((bundle) => bundle.catalog_id),
  );

  if (contract?.schema_version !== '1.0') errors.push('source refresh contract schema_version must be 1.0');
  if (!cadence || !contract?.schedule?.cron_utc) errors.push('source refresh contract requires a cadence and UTC cron');
  for (const key of ['transient_failure', 'last_known_good', 'quarantine', 'large_change_policy', 'change_evidence', 'outcome']) {
    if (!contract?.behavior?.[key]) errors.push(`source refresh contract behavior is missing ${key}`);
  }
  if (contract?.schedule?.stale_source_detection_independent !== true) {
    errors.push('stale-source detection must remain independent from refresh cadence');
  }

  for (const mapping of mappings) {
    if (!mapping.task_id || mappingById.has(mapping.task_id)) {
      errors.push(`duplicate or missing source refresh task: ${mapping.task_id || '(missing)'}`);
      continue;
    }
    mappingById.set(mapping.task_id, mapping);
    if (!mapping.script) errors.push(`source refresh task ${mapping.task_id} has no script`);
    if (!Array.isArray(mapping.source_ids) || !mapping.source_ids.length) {
      errors.push(`source refresh task ${mapping.task_id} has no governed source ownership`);
    }
    if (!Array.isArray(mapping.catalog_ids)) {
      errors.push(`source refresh task ${mapping.task_id} has no catalog scope array`);
    } else if (sourceRegistry) {
      for (const catalogId of mapping.catalog_ids) {
        if (!catalogIds.has(catalogId)) {
          errors.push(`source refresh task ${mapping.task_id} references unknown catalog ${catalogId}`);
        }
      }
    }
    if (mapping.cadence !== cadence) errors.push(`source refresh task ${mapping.task_id} has unsupported cadence ${mapping.cadence}`);
    if (!['strict', 'range_download_exception'].includes(mapping.conditional_policy)) {
      errors.push(`source refresh task ${mapping.task_id} has unsupported conditional policy ${mapping.conditional_policy}`);
    }
    validateGovernedFields(mapping, contract.behavior?.check_tiers || {}, errors);
    if (mapping.conditional_policy !== 'strict' && !mapping.exception_reason) {
      errors.push(`source refresh task ${mapping.task_id} needs an exception reason`);
    }
  }

  const remoteTasks = ingestionTasks.filter((task) => task.remote_fetch === true);
  for (const task of remoteTasks) {
    const mapping = mappingById.get(task.id);
    if (!mapping) {
      errors.push(`remote ingestion task ${task.id} is missing from the source refresh contract`);
      continue;
    }
    if (mapping.script !== task.script) {
      errors.push(`remote ingestion task ${task.id} script mismatch: ${mapping.script} != ${task.script}`);
    }
  }
  for (const mapping of mappings) {
    if (!remoteTasks.some((task) => task.id === mapping.task_id)) {
      errors.push(`source refresh contract maps non-remote task ${mapping.task_id}`);
    }
  }

  if (workflowText) {
    if (!workflowText.includes(`cron: '${contract.schedule.cron_utc}'`)) {
      errors.push(`workflow does not schedule source refresh at ${contract.schedule.cron_utc}`);
    }
    if (!workflowText.includes('npm run refresh:data')) errors.push('workflow does not execute refresh:data');
  }
  return errors;
}
