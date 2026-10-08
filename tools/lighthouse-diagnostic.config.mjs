export default {
  extends: 'lighthouse:default',
  audits: [{ path: './lighthouse-metric-inputs.audit.mjs' }],
  categories: {
    performance: { auditRefs: [{ id: 'atlas-metric-inputs', weight: 0, group: 'metrics' }] },
  },
};
