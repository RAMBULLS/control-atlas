/**
 * A tiny published STIG (one benchmark, three rules) for tests that build every
 * template. The STIG Viewer worksheet needs a chosen STIG and fails closed
 * without one.
 */
export const STIG_ID = 'BENCHMARK-EXAMPLE-STIG';

const rule = (n, severity, stigId, ruleId) => ({
  id: `disa-stig:V-${n}`,
  node_type: 'stig_rule',
  label: `V-${n} Example rule ${n}`,
  lifecycle_status: 'active',
  metadata: {
    catalog_id: 'disa-stig',
    item_id: `V-${n}`,
    title: `Example rule ${n} must be configured.`,
    severity,
    vuln_id: `V-${n}`,
    rule_id: ruleId,
    stig_id: stigId,
    benchmark_id: 'Example_STIG',
    benchmark_version: 'V1R2',
  },
});

export const stigNodes = [
  {
    id: `disa-stig:${STIG_ID}`,
    node_type: 'benchmark',
    label: 'Example Security Technical Implementation Guide',
    lifecycle_status: 'active',
    metadata: {
      catalog_id: 'disa-stig',
      item_id: STIG_ID,
      publisher_item_id: 'Example_STIG',
      title: 'Example Security Technical Implementation Guide',
      benchmark_version: 'V1R2',
      benchmark_status_date: '2026-01-15',
    },
  },
  rule(101, 'high', 'EX-0001', 'SV-101r1_rule'),
  rule(102, 'medium', 'EX-0002', 'SV-102r1_rule'),
  rule(103, 'low', 'EX-0010', 'SV-103r2_rule'),
];

export const stigEdges = stigNodes.slice(1).map((node) => ({
  id: `contains:${STIG_ID}:${node.id}`,
  relationship_type: 'contains',
  source_node_id: `disa-stig:${STIG_ID}`,
  target_node_id: node.id,
}));

/** Adds the fixture STIG to a dataset in place. */
export function addStigFixture(dataset) {
  dataset.nodes.push(...stigNodes);
  dataset.edges = [...(dataset.edges || []), ...stigEdges];
  return dataset;
}
