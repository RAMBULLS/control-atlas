/** The compact Atlas spine (data/generated/atlas-spine.json) that record pages use for their authority trace. */
export type AtlasSpineEntry = {
  id: string;
  node_type: string;
  label: string;
  blurb: string;
  parent_id: string | null;
  child_count: number;
  descendant_record_count: number;
  mandate?:
    | "statutory"
    | "contractual"
    | "federal_policy_or_regulatory_mandate"
    | "issued_without_federal_mandate";
  primary_authority?: string | null;
  also_required_by?: string[];
  publication_type?: string;
  mandate_note?: string;
  area_id?: string;
  source_refs?: Array<{
    source_id?: string;
    ref_type?: string;
    locator?: string;
  }>;
  rationale?: string;
  grouping_key?: string;
};

export type AtlasSpine = {
  entries: AtlasSpineEntry[];
};
