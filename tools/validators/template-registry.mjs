import { readFileSync } from 'node:fs';

const REQUIRED_FIELDS = [
  'template_id',
  'name',
  'display_name',
  'artifact_type',
  'supported_formats',
  'input_options',
  'required_input_options',
  'source_refs',
  'official_resource_ids',
  'compatibility',
  'provenance',
  'disclaimer_required',
];

const ARTIFACT_TYPES = new Set([
  'security_plan_starter',
  'implementation_statement_worksheet',
  'evidence_expectation_matrix',
  'stig_evidence_checklist',
  'inheritance_worksheet',
  'reciprocity_checklist',
  'poam_starter',
  'assessment_planning_worksheet',
  'conmon_calendar',
  'hardware_baseline',
  'software_baseline',
  'ppsm_preparation_worksheet',
]);

// The only interoperability labels a template may show publicly.
const COMPATIBILITY_CLASSES = new Set([
  'Verified interchange',
  'Field-aligned',
  'Concept-aligned',
]);

const FORMATS = new Set(['xlsx', 'docx']);
const INPUT_OPTIONS = new Set(['framework', 'baseline', 'control_family', 'selected_controls', 'selected_stigs', 'environment_archetype']);

export function validateTemplateRegistry(registry) {
  const errors = [];
  if (registry?.schema_version !== '1.0') {
    errors.push(`template registry schema_version must be 1.0 (got ${registry?.schema_version || 'missing'})`);
  }
  if (!registry?.templates?.length) {
    errors.push('template registry must include at least one template');
    return errors;
  }

  const seen = new Set();
  for (const template of registry.templates) {
    for (const field of REQUIRED_FIELDS) {
      if (template[field] === undefined || template[field] === null || template[field] === '') {
        errors.push(`template ${template.template_id || '<unknown>'} missing required field: ${field}`);
      }
    }
    if (template.template_id) {
      if (seen.has(template.template_id)) errors.push(`duplicate template_id: ${template.template_id}`);
      seen.add(template.template_id);
    }

    if (!ARTIFACT_TYPES.has(template.artifact_type)) {
      errors.push(`template ${template.template_id} has unsupported artifact_type: ${template.artifact_type}`);
    }

    if (Array.isArray(template.supported_formats)) {
      for (const fmt of template.supported_formats) {
        if (!FORMATS.has(fmt)) errors.push(`template ${template.template_id} has unsupported format: ${fmt}`);
      }
    } else {
      errors.push(`template ${template.template_id} supported_formats must be an array`);
    }

    if (Array.isArray(template.input_options)) {
      for (const opt of template.input_options) {
        if (!INPUT_OPTIONS.has(opt)) errors.push(`template ${template.template_id} has unsupported input_option: ${opt}`);
      }
    } else {
      errors.push(`template ${template.template_id} input_options must be an array`);
    }
    if (Array.isArray(template.required_input_options)) {
      for (const opt of template.required_input_options) {
        if (!INPUT_OPTIONS.has(opt)) {
          errors.push(`template ${template.template_id} has unsupported required_input_option: ${opt}`);
        }
        if (!template.input_options.includes(opt)) {
          errors.push(`template ${template.template_id} requires undeclared input_option: ${opt}`);
        }
      }
    } else {
      errors.push(`template ${template.template_id} required_input_options must be an array`);
    }

    if (!Array.isArray(template.source_refs)) errors.push(`template ${template.template_id} source_refs must be an array`);
    if (!Array.isArray(template.official_resource_ids) || template.official_resource_ids.length === 0) {
      errors.push(`template ${template.template_id} official_resource_ids must be a non-empty array`);
    }
    if (typeof template.disclaimer_required !== 'boolean') errors.push(`template ${template.template_id} disclaimer_required must be boolean`);

    const compatibility = template.compatibility;
    if (!compatibility || typeof compatibility !== 'object') {
      errors.push(`template ${template.template_id} missing compatibility metadata`);
    } else {
      if (!COMPATIBILITY_CLASSES.has(compatibility.classification)) {
        errors.push(`template ${template.template_id} has unsupported compatibility classification: ${compatibility.classification}`);
      }
      if ((compatibility.classification === 'Verified interchange') !== (template.provenance?.verified_interchange === true)) {
        errors.push(`template ${template.template_id} may be "Verified interchange" only when provenance.verified_interchange is true, and the reverse`);
      }
      if (typeof compatibility.claim !== 'string' || compatibility.claim.trim() === '') {
        errors.push(`template ${template.template_id} compatibility.claim must be non-empty`);
      }
      if (typeof compatibility.limitations !== 'string' || compatibility.limitations.trim() === '') {
        errors.push(`template ${template.template_id} compatibility.limitations must be non-empty`);
      }
    }

    const provenance = template.provenance;
    if (!provenance || typeof provenance !== 'object') {
      errors.push(`template ${template.template_id} missing provenance metadata`);
    } else {
      if (typeof provenance.basis !== 'string' || provenance.basis.trim() === '') {
        errors.push(`template ${template.template_id} provenance.basis must be non-empty`);
      }
      if (typeof provenance.verified_interchange !== 'boolean') {
        errors.push(`template ${template.template_id} provenance.verified_interchange must be boolean`);
      }
    }

    const alt = template.official_alternative;
    if (!alt || typeof alt !== 'object') {
      errors.push(`template ${template.template_id} missing official_alternative { label, url }`);
    } else {
      if (typeof alt.label !== 'string' || alt.label.trim() === '') {
        errors.push(`template ${template.template_id} official_alternative.label must be a non-empty string`);
      }
      if (typeof alt.url !== 'string' || !/^https:\/\//.test(alt.url)) {
        errors.push(`template ${template.template_id} official_alternative.url must be an https URL`);
      }
    }
  }

  return errors;
}

export function loadTemplateRegistry(path) {
  const fileContent = readFileSync(path, 'utf8');
  let registry;
  try {
    registry = JSON.parse(fileContent);
  } catch (err) {
    return { registry: null, errors: [`Failed to parse ${path}: ${err.message}`] };
  }
  const errors = validateTemplateRegistry(registry);
  return { registry, errors };
}
