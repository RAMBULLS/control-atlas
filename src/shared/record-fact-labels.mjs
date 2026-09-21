// Practitioner-facing labels for every field a record contract publishes as a
// "Published fact". A field without an entry here would surface its raw schema
// key on the page, so tests require one for every contract's metadata_facts.
export const RECORD_FACT_LABELS = Object.freeze({
  activity_type: "Activity type",
  architecture_component: "Architecture component",
  benchmark_status_date: "Published status date",
  benchmark_title: "Benchmark",
  benchmark_version: "Version / release",
  category: "Assessment category",
  child_count: "Contained records",
  collaborator: "Collaborator",
  component_class: "Component class",
  duration: "Duration",
  is_subtechnique: "Sub-technique",
  mapping_count: "Published mappings",
  operational_technology: "Operational technology",
  pillar: "Pillar",
  product: "Product",
  responsibility: "Responsibility",
  rule_id: "Rule ID",
  severity: "Severity",
  severity_distribution: "Severity distribution",
  stig_id: "STIG ID",
  tactic_memberships: "Tactics",
  tactic_title: "Tactic",
  vuln_id: "Finding / Vuln ID",
});
