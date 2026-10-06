/** Derived UI categories for patterns and templates (no schema migration). */

// Work-stage categories follow the ownership boundary in docs/DATA_POLICY.md:
// Plan/Implement/Assess/Remediate/Monitor, the same five stages RMF's own
// Categorize+Select, Implement, Assess, and Monitor steps use — not a
// schema-derived Authorization/Assessment/Evidence/Monitoring taxonomy that
// treated Evidence as its own phase and had no Remediate stage at all. Every
// starter document has a stage; there is no "Other" bucket.
export const TEMPLATE_CATEGORIES = {
  "Build hardware and software baselines": ["hardware_baseline", "software_baseline"],
  "Draft control implementation": [
    "implementation_statement_worksheet",
    "inheritance_worksheet",
  ],
  "Plan evidence and assessment": [
    "evidence_expectation_matrix",
    "assessment_planning_worksheet",
  ],
  "Track POA&M remediation": ["poam_starter"],
  "Plan continuous monitoring": ["conmon_calendar"],
  "Draft and reuse authorization packages": [
    "security_plan_starter",
    "reciprocity_checklist",
  ],
};

export function groupItemsByCategory(items, categoryMap, getId) {
  const grouped = new Map();
  const assigned = new Set();

  for (const [category, ids] of Object.entries(categoryMap)) {
    const matches = items.filter((item) => {
      const id = getId(item);
      if (ids.includes(id)) {
        assigned.add(id);
        return true;
      }
      return false;
    });
    if (matches.length) {
      grouped.set(category, matches);
    }
  }

  const other = items.filter((item) => !assigned.has(getId(item)));
  if (other.length) {
    grouped.set("Other", other);
  }

  return grouped;
}

export function filterByCategoryAndQuery(items, categoryMap, getId, getSearchText, filters) {
  const { category = "", query = "" } = filters;
  let filtered = items;

  if (category) {
    if (category === "Other") {
      const assigned = new Set(Object.values(categoryMap).flat());
      filtered = items.filter((item) => !assigned.has(getId(item)));
    } else {
      const ids = new Set(categoryMap[category] || []);
      filtered = items.filter((item) => ids.has(getId(item)));
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return filtered;
  }

  return filtered.filter((item) =>
    getSearchText(item).toLowerCase().includes(normalizedQuery),
  );
}
