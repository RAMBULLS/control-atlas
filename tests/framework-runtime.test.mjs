import assert from "node:assert/strict";
import test from "node:test";

import {
  createFederalGraphRuntime,
  getFederalContext,
} from "../src/app/runtime.mjs";
import { groupRelationships } from "../src/app/relationship-groups.mjs";

const fixture = {
  sources: [
    {
      id: "nist-oscal",
      name: "NIST OSCAL Content",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-53", "csf-2"] },
    },
    {
      id: "nist-map",
      name: "NIST mapping",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-53", "csf-2"] },
    },
    {
      id: "disa-stig-library",
      name: "DISA STIG Library",
      owner: "DISA",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["disa-stig"] },
    },
    {
      id: "disa-srg-library",
      name: "DISA SRG Library",
      owner: "DISA",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["disa-srg"] },
    },
    {
      id: "disa-cci-list",
      name: "DISA CCI List",
      owner: "DISA",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["disa-cci"] },
    },
    {
      id: "nist-800-53b-baselines",
      name: "NIST SP 800-53B Baseline Profiles",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      version: "2026",
      metadata: { frameworks: ["nist-800-53b"] },
    },
    {
      id: "nist-fips-199",
      name: "FIPS 199",
      owner: "NIST",
      provenance_class: "mandated",
      graph_eligible: true,
      metadata: { frameworks: ["fips-199"] },
    },
    {
      id: "nist-fips-200",
      name: "FIPS 200",
      owner: "NIST",
      provenance_class: "mandated",
      graph_eligible: true,
      metadata: { frameworks: ["fips-200"] },
    },
    {
      id: "nist-800-37-rev2",
      name: "SP 800-37 Rev. 2",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-37"] },
    },
    {
      id: "nist-800-53a-assessment-procedures",
      name: "SP 800-53A Assessment Procedures",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-53a"] },
    },
    {
      id: "fedramp-rev5",
      name: "FedRAMP Rev. 5 Baselines",
      owner: "FedRAMP",
      provenance_class: "federal_program",
      graph_eligible: true,
      version: "2026",
      metadata: { frameworks: ["fedramp-rev5"] },
    },
    {
      id: "dod-cmmc-rule",
      name: "CMMC Program Rule",
      owner: "DoD",
      provenance_class: "federal_program",
      graph_eligible: true,
      metadata: { frameworks: ["cmmc-2"] },
    },
    {
      id: "nist-800-171-rev2",
      name: "SP 800-171 Rev. 2",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-171-rev2"] },
    },
    {
      id: "nist-800-172-rev3",
      name: "SP 800-172 Rev. 3",
      owner: "NIST",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["nist-800-172"] },
    },
    {
      id: "isoo-cui-regulation",
      name: "32 CFR Part 2002",
      owner: "ISOO",
      provenance_class: "mandated",
      graph_eligible: true,
      metadata: { frameworks: ["cui-policy"] },
    },
    {
      id: "nara-cui-registry",
      name: "CUI Registry",
      owner: "NARA",
      provenance_class: "federal_published",
      graph_eligible: true,
      metadata: { frameworks: ["cui-policy"] },
    },
    {
      id: "community-research",
      name: "Community Research",
      owner: "Community",
      provenance_class: "federal_referenced",
      graph_eligible: false,
      access_status: "restricted",
      eligibility_status: "excluded",
      lifecycle_status: "deprecated",
      metadata: { frameworks: ["disa-cci"] },
    },
  ],
  nodes: [
    {
      id: "nist-800-53:AC-2",
      node_type: "control",
      label: "AC-2 Account Management",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "AC-2",
        title: "Account Management",
        description: "Manage system accounts.",
      },
    },
    {
      id: "nist-800-53:AC-3",
      node_type: "control",
      label: "AC-3 Access Enforcement",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "AC-3",
        title: "Access Enforcement",
        description: "Enforce access.",
      },
    },
    {
      id: "nist-800-53:AC-4",
      node_type: "control",
      label: "AC-4 Information Flow Enforcement",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "AC-4",
        title: "Information Flow Enforcement",
        description: "Control information flow.",
      },
    },
    {
      id: "nist-800-53a:AC-2",
      node_type: "assessment_procedure",
      label: "AC-2 Assessment Procedure",
      source_id: "nist-800-53a-assessment-procedures",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53a",
        item_id: "AC-2",
        title: "Account Management Assessment Procedure",
        description: "Assess AC-2.",
        assessment_methods: ["EXAMINE", "INTERVIEW"],
        assessment_objects: [
          ["Access control policy", "system security plan"],
          ["System owners"],
        ],
        assessment_objectives: [
          {
            label: "AC-02a.[01]",
            prose: "account types allowed are defined and documented;",
          },
        ],
        procedure_text:
          "account types allowed are defined and documented; account managers are assigned;",
      },
    },
    {
      id: "nist-800-53:FAMILY-AC",
      node_type: "family",
      label: "AC Access Control Family",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53",
        item_id: "FAMILY-AC",
        title: "Access Control",
        description: "Access control family.",
      },
    },
    {
      id: "csf-2:PR.AA-01",
      node_type: "requirement",
      label: "PR.AA-01 Identity Management",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "csf-2",
        item_id: "PR.AA-01",
        title: "Identity Management",
        description: "Identity controls.",
      },
    },
    {
      id: "csf-2:PR.AA-02",
      node_type: "requirement",
      label: "PR.AA-02 Credential Governance",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "csf-2",
        item_id: "PR.AA-02",
        title: "Credential Governance",
        description: "Govern credentials.",
      },
    },
    {
      id: "disa-stig:V-100001",
      node_type: "stig_rule",
      label: "V-100001 Sample STIG Rule",
      source_id: "disa-stig-library",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-stig",
        item_id: "V-100001",
        title: "Sample STIG Rule",
        description: "Sample STIG rule.",
        severity: "medium",
        benchmark_id: "win11",
        benchmark_title: "Windows 11 STIG",
      },
    },
    {
      id: "disa-srg:V-200001",
      node_type: "srg_requirement",
      label: "V-200001 Sample SRG Requirement",
      source_id: "disa-srg-library",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-srg",
        item_id: "V-200001",
        title: "Sample SRG Requirement",
        description: "Sample SRG requirement.",
        severity: "high",
        benchmark_id: "app-srg",
        benchmark_title: "Application SRG",
      },
    },
    {
      id: "disa-cci:CCI-000015",
      node_type: "requirement",
      label: "CCI-000015 Sample CCI",
      source_id: "disa-cci-list",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-cci",
        item_id: "CCI-000015",
        title: "Sample CCI 15",
        description: "Sample CCI mapping.",
      },
    },
    {
      id: "disa-cci:CCI-000016",
      node_type: "requirement",
      label: "CCI-000016 Sample CCI",
      source_id: "disa-cci-list",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-cci",
        item_id: "CCI-000016",
        title: "Sample CCI 16",
        description: "Second sample CCI.",
      },
    },
    {
      id: "disa-cci:CCI-000017",
      node_type: "requirement",
      label: "CCI-000017 Sample CCI",
      source_id: "disa-cci-list",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-cci",
        item_id: "CCI-000017",
        title: "Sample CCI 17",
        description: "Candidate sample CCI.",
      },
    },
    {
      id: "disa-cci:CCI-000213",
      node_type: "requirement",
      label: "CCI-000213 Sample CCI",
      source_id: "disa-cci-list",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "disa-cci",
        item_id: "CCI-000213",
        title: "Sample CCI 213",
        description: "SRG sample CCI.",
      },
    },
    {
      id: "nist-800-53b:MODERATE",
      node_type: "baseline",
      label: "MODERATE Moderate Baseline",
      source_id: "nist-800-53b-baselines",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-53b",
        item_id: "MODERATE",
        title: "Moderate Baseline",
        description: "Moderate impact baseline.",
      },
    },
    {
      id: "fips-199:FIPS-199-MODERATE",
      node_type: "impact_category",
      label: "FIPS-199-MODERATE Moderate Impact",
      source_id: "nist-fips-199",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "fips-199",
        item_id: "FIPS-199-MODERATE",
        title: "Moderate Impact",
        description: "Moderate potential impact.",
      },
    },
    {
      id: "fips-200:AC",
      node_type: "requirement",
      label: "AC Access Control",
      source_id: "nist-fips-200",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "fips-200",
        item_id: "AC",
        title: "Access Control",
        description: "Limit information system access.",
      },
    },
    {
      id: "nist-800-37:RMF-SELECT",
      node_type: "rmf_step",
      label: "RMF-SELECT Select",
      source_id: "nist-800-37-rev2",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-37",
        item_id: "RMF-SELECT",
        title: "Select",
        description: "Select controls.",
      },
    },
    {
      id: "fedramp-rev5:MODERATE",
      node_type: "baseline",
      label: "MODERATE Moderate Baseline",
      source_id: "fedramp-rev5",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "fedramp-rev5",
        item_id: "MODERATE",
        title: "Moderate Baseline",
        description: "FedRAMP moderate baseline.",
      },
    },
    {
      id: "cmmc-2:LEVEL-2",
      node_type: "program",
      label: "LEVEL-2 CMMC Level 2",
      source_id: "dod-cmmc-rule",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "cmmc-2",
        item_id: "LEVEL-2",
        title: "CMMC Level 2",
        description: "Protecting CUI using SP 800-171 Rev. 2.",
      },
    },
    {
      id: "cmmc-2:LEVEL-3",
      node_type: "program",
      label: "LEVEL-3 CMMC Level 3",
      source_id: "dod-cmmc-rule",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "cmmc-2",
        item_id: "LEVEL-3",
        title: "CMMC Level 3",
        description:
          "Protecting critical CUI using SP 800-171 Rev. 2 and SP 800-172.",
      },
    },
    {
      id: "nist-800-171-rev2:3.1.1",
      node_type: "requirement",
      label: "3.1.1 Limit system access",
      source_id: "nist-800-171-rev2",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-171-rev2",
        item_id: "3.1.1",
        title: "3.1.1",
        description: "Limit system access.",
      },
    },
    {
      id: "nist-800-171-rev2:CATALOG",
      node_type: "catalog",
      label: "SP 800-171 Rev. 2 Catalog",
      source_id: "nist-800-171-rev2",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-171-rev2",
        item_id: "CATALOG",
        title: "SP 800-171 Rev. 2 Catalog",
        description: "Catalog summary for SP 800-171 Rev. 2.",
      },
    },
    {
      id: "nist-800-171:CATALOG",
      node_type: "catalog",
      label: "SP 800-171 Rev. 3 Catalog",
      source_id: "nist-oscal",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-171",
        item_id: "CATALOG",
        title: "SP 800-171 Rev. 3 Catalog",
        description: "Catalog summary for SP 800-171 Rev. 3.",
      },
    },
    {
      id: "nist-800-172:CATALOG",
      node_type: "catalog",
      label: "SP 800-172 Rev. 3 Catalog",
      source_id: "nist-800-172-rev3",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "nist-800-172",
        item_id: "CATALOG",
        title: "SP 800-172 Rev. 3 Catalog",
        description: "Catalog summary for SP 800-172 Rev. 3.",
      },
    },
    {
      id: "cui-policy:CUI-PROGRAM",
      node_type: "policy",
      label: "CUI Program",
      source_id: "isoo-cui-regulation",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "cui-policy",
        item_id: "CUI-PROGRAM",
        title: "CUI Program",
        description: "Government-wide CUI program.",
      },
    },
    {
      id: "cui-policy:CUI-BASIC",
      node_type: "policy",
      label: "CUI Basic",
      source_id: "nara-cui-registry",
      plain_language_summary: "Plain language summary.",
      metadata: {
        catalog_id: "cui-policy",
        item_id: "CUI-BASIC",
        title: "CUI Basic",
        description: "Uniform CUI controls.",
      },
    },
  ],
  edges: [
    {
      id: "edge:m1",
      source_node_id: "nist-800-53:AC-2",
      target_node_id: "csf-2:PR.AA-01",
      relationship_type: "maps_to",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:m1"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:m2",
      source_node_id: "nist-800-53:AC-3",
      target_node_id: "csf-2:PR.AA-02",
      relationship_type: "maps_to",
      provenance_class: "federal_published",
      confidence: "indirect",
      publication_status: "candidate",
      evidence_ids: ["evidence:m2"],
      warning: "Candidate relationship",
      inference_rule_id: "sample-rule",
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:family-ac2",
      source_node_id: "nist-800-53:FAMILY-AC",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "contains",
      relationship_class: "structural",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:family-ac2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:baseline-ac2",
      source_node_id: "nist-800-53b:MODERATE",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "selects",
      relationship_class: "applicability",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:baseline-ac2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:baseline-ac3",
      source_node_id: "nist-800-53b:MODERATE",
      target_node_id: "nist-800-53:AC-3",
      relationship_type: "selects",
      relationship_class: "applicability",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:baseline-ac3"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:fips199-moderate",
      source_node_id: "fips-199:FIPS-199-MODERATE",
      target_node_id: "nist-800-53b:MODERATE",
      relationship_type: "selects",
      provenance_class: "mandated",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:fips199-moderate"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:fips200-ac",
      source_node_id: "fips-200:AC",
      target_node_id: "nist-800-53:FAMILY-AC",
      relationship_type: "references",
      provenance_class: "mandated",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:fips200-ac"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:rmf-select-baseline",
      source_node_id: "nist-800-37:RMF-SELECT",
      target_node_id: "nist-800-53b:MODERATE",
      relationship_type: "selects",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:rmf-select-baseline"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:assessment-ac2",
      source_node_id: "nist-800-53a:AC-2",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "assesses",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:assessment-ac2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:fedramp-ac2",
      source_node_id: "fedramp-rev5:MODERATE",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "selects",
      relationship_class: "applicability",
      provenance_class: "federal_program",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:fedramp-ac2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:fedramp-ac4",
      source_node_id: "fedramp-rev5:MODERATE",
      target_node_id: "nist-800-53:AC-4",
      relationship_type: "selects",
      relationship_class: "applicability",
      provenance_class: "federal_program",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:fedramp-ac4"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:stig-cci-15",
      source_node_id: "disa-stig:V-100001",
      target_node_id: "disa-cci:CCI-000015",
      relationship_type: "references",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:stig-cci-15"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:stig-cci-16",
      source_node_id: "disa-stig:V-100001",
      target_node_id: "disa-cci:CCI-000016",
      relationship_type: "references",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:stig-cci-16"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:stig-cci-17",
      source_node_id: "disa-stig:V-100001",
      target_node_id: "disa-cci:CCI-000017",
      relationship_type: "references",
      provenance_class: "federal_published",
      confidence: "indirect",
      publication_status: "candidate",
      evidence_ids: ["evidence:stig-cci-17"],
      warning: "Candidate STIG CCI link",
      inference_rule_id: "sample-stig-rule",
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:srg-cci-213",
      source_node_id: "disa-srg:V-200001",
      target_node_id: "disa-cci:CCI-000213",
      relationship_type: "references",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:srg-cci-213"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:cci-ac2",
      source_node_id: "disa-cci:CCI-000015",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "references",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:cci-ac2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:cmmc-level2-171r2",
      source_node_id: "cmmc-2:LEVEL-2",
      target_node_id: "nist-800-171-rev2:3.1.1",
      relationship_type: "requires",
      provenance_class: "federal_program",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:cmmc-level2-171r2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:cmmc-level3-171r2",
      source_node_id: "cmmc-2:LEVEL-3",
      target_node_id: "nist-800-171-rev2:CATALOG",
      relationship_type: "depends_on",
      provenance_class: "federal_program",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:cmmc-level3-171r2"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:cmmc-level3-172",
      source_node_id: "cmmc-2:LEVEL-3",
      target_node_id: "nist-800-172:CATALOG",
      relationship_type: "depends_on",
      provenance_class: "federal_program",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:cmmc-level3-172"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:171r2-cui-basic",
      source_node_id: "nist-800-171-rev2:CATALOG",
      target_node_id: "cui-policy:CUI-BASIC",
      relationship_type: "protects",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:171r2-cui-basic"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
    {
      id: "edge:172-cui-program",
      source_node_id: "nist-800-172:CATALOG",
      target_node_id: "cui-policy:CUI-PROGRAM",
      relationship_type: "supports",
      provenance_class: "federal_published",
      confidence: "direct",
      publication_status: "published",
      evidence_ids: ["evidence:172-cui-program"],
      plain_language_rationale: "Plain language rationale.",
      source_refs: [
        { source_id: "nist-oscal", ref_type: "primary", locator: "test" },
      ],
    },
  ],
  evidence: [
    {
      id: "evidence:m1",
      source_id: "nist-map",
      source_version: "2026",
      locator: "map:1",
      evidence_quality: "primary",
    },
    {
      id: "evidence:m2",
      source_id: "nist-map",
      source_version: "2026",
      locator: "map:2",
      evidence_quality: "secondary",
    },
    {
      id: "evidence:family-ac2",
      source_id: "nist-oscal",
      source_version: "2026",
      locator: "family:AC",
      evidence_quality: "primary",
    },
    {
      id: "evidence:baseline-ac2",
      source_id: "nist-800-53b-baselines",
      source_version: "2026",
      locator: "baseline:MODERATE",
      evidence_quality: "primary",
    },
    {
      id: "evidence:baseline-ac3",
      source_id: "nist-800-53b-baselines",
      source_version: "2026",
      locator: "baseline:MODERATE:AC-3",
      evidence_quality: "primary",
    },
    {
      id: "evidence:fips199-moderate",
      source_id: "nist-fips-199",
      source_version: "2004",
      locator: "section-3",
      evidence_quality: "primary",
    },
    {
      id: "evidence:fips200-ac",
      source_id: "nist-fips-200",
      source_version: "2006",
      locator: "section-3",
      evidence_quality: "primary",
    },
    {
      id: "evidence:rmf-select-baseline",
      source_id: "nist-800-37-rev2",
      source_version: "2018",
      locator: "section-3.2",
      evidence_quality: "primary",
    },
    {
      id: "evidence:assessment-ac2",
      source_id: "nist-800-53a-assessment-procedures",
      source_version: "2026",
      locator: "AC-2",
      evidence_quality: "primary",
    },
    {
      id: "evidence:fedramp-ac2",
      source_id: "fedramp-rev5",
      source_version: "2026",
      locator: "moderate:AC-2",
      evidence_quality: "primary",
    },
    {
      id: "evidence:fedramp-ac4",
      source_id: "fedramp-rev5",
      source_version: "2026",
      locator: "moderate:AC-4",
      evidence_quality: "primary",
    },
    {
      id: "evidence:stig-cci-15",
      source_id: "disa-stig-library",
      source_version: "2026",
      locator: "win11#V-100001",
      evidence_quality: "primary",
    },
    {
      id: "evidence:stig-cci-16",
      source_id: "disa-stig-library",
      source_version: "2026",
      locator: "win11#V-100001",
      evidence_quality: "primary",
    },
    {
      id: "evidence:stig-cci-17",
      source_id: "disa-stig-library",
      source_version: "2026",
      locator: "win11#V-100001",
      evidence_quality: "secondary",
    },
    {
      id: "evidence:srg-cci-213",
      source_id: "disa-srg-library",
      source_version: "2026",
      locator: "app-srg#V-200001",
      evidence_quality: "primary",
    },
    {
      id: "evidence:cci-ac2",
      source_id: "disa-cci-list",
      source_version: "2026",
      locator: "CCI-000015",
      evidence_quality: "primary",
    },
    {
      id: "evidence:cmmc-level2-171r2",
      source_id: "dod-cmmc-rule",
      source_version: "2026",
      locator: "32-CFR-170.14(c)(3)",
      evidence_quality: "primary",
    },
    {
      id: "evidence:cmmc-level3-171r2",
      source_id: "dod-cmmc-rule",
      source_version: "2026",
      locator: "32-CFR-170.14(c)(4)",
      evidence_quality: "primary",
    },
    {
      id: "evidence:cmmc-level3-172",
      source_id: "dod-cmmc-rule",
      source_version: "2026",
      locator: "32-CFR-170.14(c)(4)",
      evidence_quality: "primary",
    },
    {
      id: "evidence:171r2-cui-basic",
      source_id: "nist-800-171-rev2",
      source_version: "2021",
      locator: "abstract",
      evidence_quality: "primary",
    },
    {
      id: "evidence:172-cui-program",
      source_id: "nist-800-172-rev3",
      source_version: "2026",
      locator: "abstract",
      evidence_quality: "primary",
    },
  ],
  findings: [
    {
      id: "finding:1",
      finding_type: "blocked_relationship",
      severity: "warning",
      source_id: "excluded",
      subject_id: "edge:x",
      message: "Blocked",
    },
  ],
  librarySearch: {
    serialized_index: "",
    documents: [
      {
        id: "nist-800-53:AC-2",
        item_id: "AC-2",
        title: "Account Management",
        description: "Manage system accounts.",
        object_type: "control",
        source_id: "nist-oscal",
        source_class: "federal_published",
        catalog_id: "nist-800-53",
        control_family: "Access Control",
        severity: "",
      },
      {
        id: "disa-stig:V-100001",
        item_id: "V-100001",
        title: "Sample STIG Rule",
        description: "Sample severity finding.",
        object_type: "stig_rule",
        source_id: "nist-map",
        source_class: "federal_published",
        catalog_id: "disa-stig",
        control_family: "",
        severity: "high",
      },
    ],
  },
};

test("runtime searches graph nodes by exact ID before text", () => {
  const runtime = createFederalGraphRuntime(fixture);
  assert.equal(runtime.searchNodes("AC-2")[0].id, "nist-800-53:AC-2");
  assert.equal(
    runtime.searchNodes("Access Enforcement")[0].id,
    "nist-800-53:AC-3",
  );
  assert.equal(
    runtime.searchNodes("Credential Governance")[0].id,
    "csf-2:PR.AA-02",
  );
});

test("runtime resolves practitioner paren notation to dot-notation enhancements", () => {
  // Self-contained dataset: base control + its enhancement, so the alias is
  // exercised without perturbing the shared fixture's node/matrix counts.
  const notationNode = (id, itemId, type) => ({
    id,
    node_type: type,
    label: `${itemId} label`,
    metadata: { catalog_id: "nist-800-53", item_id: itemId, title: itemId },
  });
  const notationDoc = (id, itemId, type) => ({
    id,
    item_id: itemId,
    title: `${itemId} title`,
    description: "",
    object_type: type,
    source_id: "nist-oscal",
    source_class: "federal_published",
    catalog_id: "nist-800-53",
    control_family: "Access Control",
    severity: "",
  });
  const runtime = createFederalGraphRuntime({
    nodes: [
      notationNode("nist-800-53:AC-2", "AC-2", "control"),
      notationNode("nist-800-53:AC-2.1", "AC-2.1", "control_enhancement"),
    ],
    edges: [],
    evidence: [],
    sources: [],
    graphHealth: [],
    librarySearch: {
      serialized_index: "",
      documents: [
        notationDoc("nist-800-53:AC-2", "AC-2", "control"),
        notationDoc("nist-800-53:AC-2.1", "AC-2.1", "control_enhancement"),
      ],
    },
  });
  // searchNodes: "AC-2(1)" and "AC-2 (1)" both reach the AC-2.1 enhancement.
  assert.equal(runtime.searchNodes("AC-2(1)")[0].id, "nist-800-53:AC-2.1");
  assert.equal(runtime.searchNodes("AC-2 (1)")[0].id, "nist-800-53:AC-2.1");
  // Plain "AC-2" still resolves to the base control, not the enhancement.
  assert.equal(runtime.searchNodes("AC-2")[0].id, "nist-800-53:AC-2");
  // searchLibrary (the Explore surface) applies the same alias.
  assert.equal(runtime.searchLibrary("AC-2(1)")[0].id, "nist-800-53:AC-2.1");
  assert.equal(runtime.searchLibrary("AC-2")[0].id, "nist-800-53:AC-2");
});

test("runtime exposes source-backed edges, evidence, sources, and graph health", () => {
  const runtime = createFederalGraphRuntime(fixture);
  assert.equal(runtime.getNode("csf-2:PR.AA-01").metadata.item_id, "PR.AA-01");
  assert.equal(runtime.getNodes({ catalog_id: "nist-800-53" }).length, 4);
  assert.equal(runtime.getEdgesForNode("nist-800-53:AC-2")[0].id, "edge:m1");
  assert.equal(
    runtime.getEvidenceForEdge("edge:m1")[0].source.name,
    "NIST mapping",
  );
  assert.equal(runtime.getSources().length, 17);
  assert.equal(runtime.getGraphHealth().length, 1);
});

test("runtime builds an object-local neighborhood with filters and caps", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const neighborhood = runtime.buildNeighborhood("nist-800-53:AC-2");
  assert.ok(neighborhood.centerNode);
  assert.ok(neighborhood.nodes.some((node) => node.id === "nist-800-53:AC-2"));
  assert.ok(neighborhood.edges.some((edge) => edge.id === "edge:m1"));
  assert.equal(neighborhood.stats.nodeCount >= 2, true);

  const filtered = runtime.buildNeighborhood("nist-800-53:AC-2", {
    relationship_type: "maps_to",
  });
  assert.ok(
    filtered.edges.every((edge) => edge.relationship_type === "maps_to"),
  );

  const inferredHidden = runtime.buildNeighborhood("disa-stig:V-100001");
  const inferredVisible = runtime.buildNeighborhood("disa-stig:V-100001", {
    include_candidates: true,
  });
  assert.ok(
    inferredHidden.edges.every(
      (edge) => edge.publication_status === "published",
    ),
  );
  assert.ok(
    inferredVisible.edges.some(
      (edge) => edge.publication_status === "candidate",
    ),
  );

  const empty = runtime.buildNeighborhood("missing-node");
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.centerNode, null);
});

test("runtime filters sources and supports source lookup for provenance detail views", () => {
  const runtime = createFederalGraphRuntime(fixture);

  assert.equal(runtime.getSource("nist-oscal").name, "NIST OSCAL Content");
  assert.equal(runtime.getSource("missing-source"), null);
  assert.deepEqual(
    runtime
      .getSources({ provenance_class: "mandated" })
      .map((source) => source.id),
    ["nist-fips-199", "nist-fips-200", "isoo-cui-regulation"],
  );
  assert.deepEqual(
    runtime
      .getSources({ eligibility_status: "excluded" })
      .map((source) => source.id),
    ["community-research"],
  );
  assert.deepEqual(
    runtime
      .getSources({
        lifecycle_status: "deprecated",
        access_status: "restricted",
        graph_eligible: false,
      })
      .map((source) => source.id),
    ["community-research"],
  );
});

test("runtime builds a catalog relationship matrix and CSV from graph edges", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const matrix = runtime.buildRelationshipMatrix({
    source_catalog: "nist-800-53",
    target_catalog: "csf-2",
  });
  assert.equal(matrix.rows.length, 4);
  assert.equal(matrix.rows[0].classification, "published");
  assert.equal(matrix.rows[1].classification, "candidate");
  assert.match(runtime.buildRelationshipCsv(matrix), /AC-2/);
});

test("runtime reports honest per-catalog connectivity (CATL-24)", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const catalogs = runtime.getCatalogs();
  for (const catalog of catalogs) {
    assert.equal(
      typeof catalog.connected_count,
      "number",
      `${catalog.id} missing connected_count`,
    );
    assert.ok(
      catalog.connected_count <= catalog.node_count,
      `${catalog.id} connected_count exceeds node_count`,
    );
    assert.ok(catalog.connected_count >= 0);
    assert.equal(
      typeof catalog.cross_catalog_connected_count,
      "number",
      `${catalog.id} missing cross_catalog_connected_count`,
    );
    assert.ok(
      catalog.cross_catalog_connected_count <= catalog.connected_count,
      `${catalog.id} cross-catalog count exceeds total connected count`,
    );
  }
  // A catalog whose nodes all sit on published edges reports full connectivity.
  const nist = catalogs.find((catalog) => catalog.id === "nist-800-53");
  assert.ok(nist);
  assert.ok(nist.connected_count > 0);
  assert.ok(nist.cross_catalog_connected_count > 0);
  const csf = catalogs.find((catalog) => catalog.id === "csf-2");
  assert.equal(csf.cross_catalog_connected_count, 1, "candidate mappings do not count");
  const fedramp = catalogs.find((catalog) => catalog.id === "fedramp-rev5");
  assert.equal(
    fedramp.cross_catalog_connected_count,
    0,
    "cross-catalog applicability edges are not mappings",
  );
});

test("cross-catalog coverage excludes secondary authority and unpublished edges", () => {
  const runtime = createFederalGraphRuntime({
    sources: [],
    evidence: [],
    findings: [],
    nodes: [
      {
        id: "a:ONE",
        node_type: "catalog",
        metadata: {
          catalog_id: "a",
          mandate: "contractual",
          primary_authority: "authority:CLAUSE",
          also_required_by: ["authority:REGULATION"],
          publication_type: "control catalog",
          mandate_note: "Required when selected in a covered contract.",
        },
      },
      { id: "b:TWO", metadata: { catalog_id: "b" } },
    ],
    edges: [
      {
        id: "edge:authority",
        source_node_id: "a:ONE",
        target_node_id: "b:TWO",
        relationship_type: "issued_under",
        publication_status: "published",
      },
      {
        id: "edge:missing-status",
        source_node_id: "a:ONE",
        target_node_id: "b:TWO",
        relationship_type: "maps_to",
      },
    ],
  });

  assert.ok(
    runtime
      .getCatalogs()
      .every((catalog) => catalog.cross_catalog_connected_count === 0),
  );
  const catalog = runtime.getCatalogs().find((entry) => entry.id === "a");
  assert.equal(catalog.mandate, "contractual");
  assert.equal(catalog.primary_authority, "authority:CLAUSE");
  assert.deepEqual(catalog.also_required_by, ["authority:REGULATION"]);
  assert.equal(catalog.publication_type, "control catalog");
  assert.equal(
    catalog.mandate_note,
    "Required when selected in a covered contract.",
  );
});

test("runtime filters library documents by keyword and facets", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const controlResults = runtime.searchLibrary("account", {
    object_type: "control",
    source_class: "federal_published",
  });
  assert.deepEqual(
    controlResults.map((entry) => entry.id),
    ["nist-800-53:AC-2"],
  );

  const severityResults = runtime.searchLibrary("", { severity: "high" });
  assert.deepEqual(
    severityResults.map((entry) => entry.id),
    ["disa-stig:V-100001"],
  );
});

test("runtime applies governed taxonomy facets before the result cap and returns full contextual counts", () => {
  const fields = [
    "id",
    "item_id",
    "title",
    "object_type",
    "source_class",
    "catalog_id",
    "publisher_name",
    "published_connection_count",
    "taxonomy_tags",
  ];
  const documents = Array.from({ length: 120 }, (_, index) => ({
    id: `test:FILLER-${index}`,
    item_id: `FILLER-${index}`,
    title: `Filler ${index}`,
    object_type: "control",
    source_class: "federal_published",
    catalog_id: "test",
    publisher_name: "Test",
    published_connection_count: 0,
    taxonomy_tags: [],
  }));
  documents.push(
    {
      ...documents[0],
      id: "test:SERVER-MS",
      item_id: "SERVER-MS",
      taxonomy_tags: [{ id: "asset.server" }, { id: "vendor.microsoft" }],
    },
    {
      ...documents[0],
      id: "test:WORKSTATION-MS",
      item_id: "WORKSTATION-MS",
      taxonomy_tags: [{ id: "asset.workstation" }, { id: "vendor.microsoft" }],
    },
    {
      ...documents[0],
      id: "test:SERVER-LINUX",
      item_id: "SERVER-LINUX",
      taxonomy_tags: [{ id: "asset.server" }, { id: "vendor.linux" }],
    },
  );
  const runtime = createFederalGraphRuntime({
    sources: [],
    nodes: [],
    edges: [],
    evidence: [],
    findings: [],
    librarySearch: {
      indexed_transport: {
        format: "columns-v1",
        fields,
        columns: fields.map((field) => documents.map((document) => document[field])),
      },
    },
  });

  assert.equal(runtime.searchLibrary("").length, 100);
  assert.deepEqual(
    runtime.searchLibrary("", { taxonomy_tag_groups: [["asset.server"]] }).map((entry) => entry.id),
    ["test:SERVER-LINUX", "test:SERVER-MS"],
  );
  assert.equal(
    runtime.getLibraryTagContext("", {
      taxonomy_tag_groups: [["asset.server", "asset.workstation"], ["vendor.microsoft"]],
    }).result_count,
    2,
  );
  assert.equal(runtime.getLibraryTagContext("", {}).result_count, 123);
  assert.equal(runtime.getLibraryTagContext("", {}).tags["asset.server"], 2);
});

test("runtime builds relationship rows and hides inferred candidates by default", () => {
  const runtime = createFederalGraphRuntime(fixture);

  const publishedOnly = runtime.buildRelationshipRows({
    source_catalog: "nist-800-53",
    target_catalog: "csf-2",
  });
  assert.deepEqual(
    publishedOnly.rows.map((row) => row.from_item_id),
    ["AC-2"],
  );
  assert.equal(publishedOnly.summary.hidden_candidate_count, 1);
  assert.equal(
    publishedOnly.rows[0].source_refs[0].source_name,
    "NIST mapping",
  );
  assert.equal(
    publishedOnly.rows[0].source_refs[0].evidence_quality,
    "primary",
  );

  const withCandidates = runtime.buildRelationshipRows({
    source_catalog: "nist-800-53",
    target_catalog: "csf-2",
    include_candidates: true,
  });
  assert.deepEqual(
    withCandidates.rows.map((row) => row.from_item_id),
    ["AC-2", "AC-3"],
  );
  assert.equal(withCandidates.rows[1].publication_status, "candidate");
});

test("runtime offers only published cross-catalog comparison pairs", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const connections = runtime.getConnectedCatalogs("nist-800-53");

  assert.ok(connections.length > 0);
  assert.ok(connections.every((entry) => entry.connection_count > 0));
  assert.deepEqual(
    connections.find((entry) => entry.id === "csf-2"),
    { id: "csf-2", name: "NIST CSF 2.0", connection_count: 1 },
  );
  assert.deepEqual(runtime.getConnectedCatalogs("unknown-catalog"), []);
});

test("runtime builds STIG to CCI to NIST chains for package and item scopes", () => {
  const runtime = createFederalGraphRuntime(fixture);

  const packageScope = runtime.buildStigChain({
    chain_catalog: "disa-stig",
  });
  assert.deepEqual(
    packageScope.rows.map((row) => row.item_id),
    ["V-100001"],
  );
  assert.equal(packageScope.rows[0].cci_count, 2);
  assert.equal(packageScope.rows[0].nist_control_count, 1);

  const itemScope = runtime.buildStigChain({
    chain_catalog: "disa-stig",
    chain_item: "disa-stig:V-100001",
  });
  assert.equal(itemScope.selected_chain.source_node.id, "disa-stig:V-100001");
  assert.deepEqual(
    itemScope.selected_chain.cci_nodes.map((node) => node.id),
    ["disa-cci:CCI-000015", "disa-cci:CCI-000016"],
  );
  assert.deepEqual(
    itemScope.selected_chain.nist_nodes.map((node) => node.id),
    ["nist-800-53:AC-2"],
  );
  assert.deepEqual(
    itemScope.selected_chain.unmapped_cci_nodes.map((node) => node.id),
    ["disa-cci:CCI-000016"],
  );

  const withCandidates = runtime.buildStigChain({
    chain_catalog: "disa-stig",
    chain_item: "disa-stig:V-100001",
    include_candidates: true,
  });
  assert.deepEqual(
    withCandidates.selected_chain.cci_nodes.map((node) => node.id),
    ["disa-cci:CCI-000015", "disa-cci:CCI-000016", "disa-cci:CCI-000017"],
  );
  assert.equal(
    withCandidates.selected_chain.cci_entries.find(
      (entry) => entry.cciNode.id === "disa-cci:CCI-000017",
    )?.relationshipEdge.publication_status,
    "candidate",
  );
});

test("runtime compares public baselines into shared and delta control sets", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const comparison = runtime.buildBaselineComparison({
    baseline_a: "nist-800-53b:MODERATE",
    baseline_b: "fedramp-rev5:MODERATE",
  });

  assert.equal(comparison.baseline_a.id, "nist-800-53b:MODERATE");
  assert.equal(comparison.baseline_b.id, "fedramp-rev5:MODERATE");
  assert.equal(
    comparison.baseline_a_source.name,
    "NIST SP 800-53B Baseline Profiles",
  );
  assert.equal(comparison.baseline_a_source.version, "2026");
  assert.equal(comparison.baseline_b_source.name, "FedRAMP Rev. 5 Baselines");
  assert.equal(comparison.baseline_b_source.version, "2026");
  assert.deepEqual(
    comparison.shared.map((entry) => entry.control_node.id),
    ["nist-800-53:AC-2"],
  );
  assert.deepEqual(
    comparison.only_a.map((entry) => entry.control_node.id),
    ["nist-800-53:AC-3"],
  );
  assert.deepEqual(
    comparison.only_b.map((entry) => entry.control_node.id),
    ["nist-800-53:AC-4"],
  );

  const markdown = runtime.exportBaselineComparison(comparison, "markdown");
  assert.match(
    markdown,
    /Baseline A: MODERATE — Moderate Baseline \(NIST SP 800-53B Baseline Profiles v2026\)/,
  );
  assert.match(
    markdown,
    /Baseline B: MODERATE — Moderate Baseline \(FedRAMP Rev\. 5 Baselines v2026\)/,
  );

  const parsed = JSON.parse(
    runtime.exportBaselineComparison(comparison, "json"),
  );
  assert.equal(parsed.baseline_a_source.version, "2026");
  assert.equal(parsed.baseline_b_source.version, "2026");
});

test("relationship exports mirror the current visible rows", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const relationshipRows = runtime.buildRelationshipRows({
    source_catalog: "disa-stig",
    target_catalog: "disa-cci",
  });

  const csv = runtime.exportRelationshipRows(relationshipRows.rows, "csv");
  const markdown = runtime.exportRelationshipRows(
    relationshipRows.rows,
    "markdown",
  );
  const json = runtime.exportRelationshipRows(relationshipRows.rows, "json");

  assert.match(
    csv,
    /"From ID","To ID","From tags","To tags","Relationship type","Source basis","Confidence","Rationale","Navigation note","Source references"/,
  );
  assert.match(csv, /V-100001/);
  assert.match(markdown, /\| From ID \| To ID \| From tags \| To tags \| Relationship type \|/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].from_item_id, "V-100001");
  assert.ok(Array.isArray(parsed[0].from_taxonomy_tags));
});

test("runtime composes issue 10 federal context for a control from adjacent nodes", () => {
  const runtime = createFederalGraphRuntime(fixture);
  const context = getFederalContext(runtime, "nist-800-53:AC-2");

  assert.deepEqual(
    context.baselineMembership.map((entry) => entry.baselineNode.id),
    ["nist-800-53b:MODERATE"],
  );
  assert.deepEqual(
    context.categorizationContext.map((entry) => entry.categoryNode.id),
    ["fips-199:FIPS-199-MODERATE"],
  );
  assert.deepEqual(
    context.minimumSecurityRequirements.map(
      (entry) => entry.requirementNode.id,
    ),
    ["fips-200:AC"],
  );
  assert.deepEqual(
    context.rmfLifecycle.map((entry) => entry.stepNode.id),
    ["nist-800-37:RMF-SELECT"],
  );
  assert.deepEqual(
    context.assessmentContext.map((entry) => entry.assessmentNode.id),
    ["nist-800-53a:AC-2"],
  );
  assert.deepEqual(
    context.fedrampBaselineContext.map((entry) => entry.baselineNode.id),
    ["fedramp-rev5:MODERATE"],
  );
  assert.deepEqual(
    context.assessmentContext[0].assessmentNode.metadata.assessment_methods,
    ["EXAMINE", "INTERVIEW"],
  );
});

test("runtime composes issue 12 program and CUI context without implying a rev3 bridge", () => {
  const runtime = createFederalGraphRuntime(fixture);

  const requirementContext = getFederalContext(
    runtime,
    "nist-800-171-rev2:3.1.1",
  );
  assert.deepEqual(
    requirementContext.programRequirementContext.map(
      (entry) => entry.relatedNode.id,
    ),
    ["cmmc-2:LEVEL-2"],
  );
  assert.deepEqual(requirementContext.cuiPolicyContext, []);

  const cmmcContext = getFederalContext(runtime, "cmmc-2:LEVEL-3");
  assert.deepEqual(
    cmmcContext.cmmcProgramContext.map((entry) => entry.relatedNode.id),
    ["nist-800-171-rev2:CATALOG", "nist-800-172:CATALOG"],
  );

  const cuiContext = getFederalContext(runtime, "cui-policy:CUI-BASIC");
  assert.deepEqual(
    cuiContext.cuiPolicyContext.map((entry) => entry.relatedNode.id),
    ["nist-800-171-rev2:CATALOG"],
  );

  const rev3Context = getFederalContext(runtime, "nist-800-171:CATALOG");
  assert.deepEqual(rev3Context.programRequirementContext, []);
});

// ---------------------------------------------------------------------------
// Relationship grouping: enhancements / baseControl groups (Task 3)
// ---------------------------------------------------------------------------

function makeRelationshipGroupsFixtureRuntime() {
  const nodesById = new Map([
    [
      "nist-800-53:AC-2",
      {
        id: "nist-800-53:AC-2",
        node_type: "control",
        label: "AC-2 Account Management",
        metadata: {
          catalog_id: "nist-800-53",
          item_id: "AC-2",
          title: "Account Management",
        },
      },
    ],
    [
      "nist-800-53:AC-2.1",
      {
        id: "nist-800-53:AC-2.1",
        node_type: "control_enhancement",
        label: "AC-2(1) Automated System Account Management",
        metadata: {
          catalog_id: "nist-800-53",
          item_id: "AC-2.1",
          title: "Automated System Account Management",
        },
      },
    ],
    [
      "nist-800-53:AC-2.2",
      {
        id: "nist-800-53:AC-2.2",
        node_type: "control_enhancement",
        label: "AC-2(2) Automated Temporary and Emergency Account Management",
        metadata: {
          catalog_id: "nist-800-53",
          item_id: "AC-2.2",
          title: "Automated Temporary and Emergency Account Management",
        },
      },
    ],
    [
      "nist-800-53:AC-3",
      {
        id: "nist-800-53:AC-3",
        node_type: "control",
        label: "AC-3 Access Enforcement",
        metadata: {
          catalog_id: "nist-800-53",
          item_id: "AC-3",
          title: "Access Enforcement",
        },
      },
    ],
  ]);
  return { getNode: (id) => nodesById.get(id) || null };
}

test("groupRelationships routes a control's own enhancement counterparts into the enhancements group", () => {
  const runtime = makeRelationshipGroupsFixtureRuntime();
  const edges = [
    {
      id: "edge:ac2-ac2.1",
      source_node_id: "nist-800-53:AC-2",
      target_node_id: "nist-800-53:AC-2.1",
      relationship_type: "contains",
      relationship_class: "structural",
    },
    {
      id: "edge:ac2-ac2.2",
      source_node_id: "nist-800-53:AC-2",
      target_node_id: "nist-800-53:AC-2.2",
      relationship_type: "contains",
      relationship_class: "structural",
    },
    {
      id: "edge:ac2-ac3",
      source_node_id: "nist-800-53:AC-2",
      target_node_id: "nist-800-53:AC-3",
      relationship_type: "related_to",
    },
  ];

  const grouped = groupRelationships(edges, "nist-800-53:AC-2", runtime);
  const enhancementsGroup = grouped.find((g) => g.id === "enhancements");
  const nistControlGroup = grouped.find((g) => g.id === "nistControl");

  assert.ok(enhancementsGroup, "Expected an enhancements group");
  assert.equal(enhancementsGroup.label, "Enhancements");
  assert.equal(enhancementsGroup.items.length, 2);
  assert.deepEqual(
    enhancementsGroup.items.map((item) => item.counterpart.id).sort(),
    ["nist-800-53:AC-2.1", "nist-800-53:AC-2.2"],
  );

  // Unrelated control (AC-3) stays in the generic nistControl group, not enhancements.
  assert.ok(nistControlGroup, "Expected AC-3 to remain in nistControl group");
  assert.equal(nistControlGroup.items.length, 1);
  assert.equal(nistControlGroup.items[0].counterpart.id, "nist-800-53:AC-3");
});

test("groupRelationships routes an enhancement's base control counterpart into the baseControl group", () => {
  const runtime = makeRelationshipGroupsFixtureRuntime();
  const edges = [
    {
      id: "edge:ac2.1-ac2",
      source_node_id: "nist-800-53:AC-2.1",
      target_node_id: "nist-800-53:AC-2",
      relationship_type: "contains",
      relationship_class: "structural",
    },
  ];

  const grouped = groupRelationships(edges, "nist-800-53:AC-2.1", runtime);
  const baseControlGroup = grouped.find((g) => g.id === "baseControl");

  assert.ok(baseControlGroup, "Expected a baseControl group");
  assert.equal(baseControlGroup.label, "Base control");
  assert.equal(baseControlGroup.items.length, 1);
  assert.equal(baseControlGroup.items[0].counterpart.id, "nist-800-53:AC-2");
});

test("runtime complete search artifact returns exact and plain-language results", () => {
  const documents = [
    {
      id: "nist-800-53:AC-2",
      item_id: "AC-2",
      title: "Account Management",
      description: "Manage system accounts.",
      plain_language_summary:
        "Manage who can use the system and how accounts are approved.",
      object_type: "control",
      source_id: "nist-oscal",
      source_name: "SP 800-53 Rev. 5",
      source_class: "federal_published",
      catalog_id: "nist-800-53",
      control_family: "Access Control",
      severity: "",
    },
    {
      id: "test:fedramp-2026",
      item_id: "FR-2026",
      title: "FedRAMP rules for 2026",
      description: "Current rules source.",
      plain_language_summary: "Current FedRAMP transition rules.",
      object_type: "requirement",
      source_id: "fedramp",
      source_name: "FedRAMP",
      source_class: "federal_published",
      catalog_id: "test",
      control_family: "",
      severity: "",
    },
    {
      id: "test:fedramp-legacy",
      item_id: "FR-LEGACY",
      title: "FedRAMP legacy baseline",
      description: "Historical baseline.",
      plain_language_summary: "Legacy reference.",
      object_type: "baseline",
      source_id: "fedramp",
      source_name: "FedRAMP",
      source_class: "federal_published",
      catalog_id: "test",
      control_family: "",
      severity: "",
    },
    {
      id: "test:year-2026",
      item_id: "YEAR-2026",
      title: "Unrelated 2026 publication",
      description: "Different program publication.",
      plain_language_summary: "Unrelated publication.",
      object_type: "requirement",
      source_id: "other",
      source_name: "Other",
      source_class: "federal_published",
      catalog_id: "test",
      control_family: "",
      severity: "",
    },
  ];
  const runtime = createFederalGraphRuntime({
    sources: [],
    nodes: [],
    edges: [],
    evidence: [],
    findings: [],
    librarySearch: {
      documents,
    },
  });

  assert.equal(runtime.searchLibrary("AC-2")[0].id, "nist-800-53:AC-2");
  assert.equal(
    runtime.searchLibrary("account management")[0].id,
    "nist-800-53:AC-2",
  );
  assert.equal(
    runtime.searchLibrary("manage system accounts")[0].id,
    "nist-800-53:AC-2",
  );
  assert.deepEqual(
    runtime.searchLibrary("FedRAMP 2026").map((entry) => entry.id),
    ["test:fedramp-2026"],
  );
  // The search-phase runtime has no sources loaded; the result card falls
  // back to the source_name embedded in the complete search artifact.
  assert.equal(
    runtime.searchLibrary("AC-2")[0].source_name,
    "SP 800-53 Rev. 5",
  );
});

test("full graph runtime hydrates compact search documents with official source text", () => {
  const runtime = createFederalGraphRuntime({
    sources: [],
    nodes: [
      {
        id: "test:AC-1",
        label: "Policy and Procedures",
        metadata: {
          item_id: "AC-1",
          description: "Publisher-authored control text.",
        },
      },
    ],
    edges: [],
    evidence: [],
    findings: [],
    librarySearch: {
      documents: [
        {
          id: "test:AC-1",
          item_id: "AC-1",
          title: "Policy and Procedures",
        },
      ],
    },
  });

  assert.equal(
    runtime.getLibraryDocument("test:AC-1").description,
    "Publisher-authored control text.",
  );
});

test("STIG catalog chain returns complete nodes without a 250 record cap", () => {
  const mockNodes = Array.from({ length: 350 }, (_, i) => ({
    id: `disa-stig:TEST_BENCHMARK:SV-${i}_rule`,
    node_type: "stig_rule",
    label: `Rule ${i}`,
    metadata: {
      catalog_id: "disa-stig",
      item_id: `SV-${i}_rule`,
      title: `Rule ${i}`,
    },
  }));

  const runtime = createFederalGraphRuntime({
    sources: [],
    nodes: mockNodes,
    edges: [],
    evidence: [],
    findings: [],
  });

  const chain = runtime.buildStigChain({ chain_catalog: "disa-stig" });
  assert.equal(chain.rows.length, 350, "All 350 STIG nodes must be included without 250 truncation");
});

test("restored reference editions have distinct published names in generated catalog pickers", () => {
  const ids = ["csf-2", "nist-csf-1.1", "nist-critical-software"];
  const runtime = createFederalGraphRuntime({
    sources: [], edges: [], evidence: [], findings: [],
    nodes: ids.map((id) => ({ id: `${id}:fixture`, node_type: "requirement", label: "Unit fixture",
      metadata: { catalog_id: id, item_id: "fixture", title: "Unit fixture" } })),
  });
  const catalogs = runtime.getCatalogs();
  assert.deepEqual(catalogs.map((catalog) => catalog.id).sort(), ids.sort());
  assert.equal(new Set(catalogs.map((catalog) => catalog.name)).size, 3);
  for (const catalog of catalogs) {
    assert.notEqual(catalog.name, catalog.id);
    assert.equal(catalog.display_group, "NIST");
  }
  assert.equal(catalogs.find((catalog) => catalog.id === "nist-csf-1.1").name, "NIST CSF 1.1");
  assert.equal(catalogs.find((catalog) => catalog.id === "nist-critical-software").name, "NIST Critical Software Security Measures");
});

test("runtime preserves exact dotted ATT&CK sub-technique identifiers", () => {
  const node = {
    id: "mitre-attack:T1098.004",
    node_type: "attack_technique",
    label: "T1098.004 SSH Authorized Keys",
    metadata: { catalog_id: "mitre-attack", item_id: "T1098.004", title: "SSH Authorized Keys" },
  };
  const runtime = createFederalGraphRuntime({
    nodes: [node],
    edges: [],
    evidence: [],
    sources: [],
    graphHealth: [],
    librarySearch: { serialized_index: "", documents: [] },
  });
  assert.equal(runtime.searchNodes("T1098.004")[0].id, node.id);
});
