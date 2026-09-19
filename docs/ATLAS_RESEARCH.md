# Atlas research — browser integration checkpoint

- **Owner:** Product owner and Muse
- **Status:** Draft, tracked by #260 and PR #261; this is not the completed Atlas vNext redesign.
- **Last reviewed:** 2026-09-18
- **Supersession:** Replaced by docs/ATLAS_VNEXT_DESIGN.md when Atlas vNext is accepted.

## What this checkpoint owns

Atlas gains an opt-in **Find a connection** view. Visitors can find and pin up to six real records, choose endpoints, follow bounded published paths, inspect each original connection, and find records linked to every pin. Pins, endpoints, search depth and traversal direction are encoded in the Atlas URL. Returning to the map preserves its prior scope; ordinary Atlas URLs remain unchanged.

The default follows recorded edge direction. Reverse traversal requires an explicit choice and is labeled at each hop. An undirected assertion stays undirected. A path is a research trail, not a transitive mapping, an authority chain, equivalence, applicability, or evidence of compliance. Record pins do not currently aggregate all the descendants of a pinned publication.

## Data and performance contract

The static-site builder produces a versioned manifest and content-addressed research index from the same accepted node/edge snapshot used by the site. It verifies input counts and matching snapshot dates, preserves original admitted edge objects, and fails on duplicate or dangling identities. Only the existing research policy's published publisher assertions are admitted. Organizing edges, containment shortcuts, candidates and inferences are excluded. Historical assertions remain in the index for future explicit lifecycle work but are not traversed by this UI.

A dedicated worker loads, decompresses, verifies the SHA-256 digest, validates versions/counts, and constructs the graph. No result is returned from a partial or invalid index. The main thread receives only bounded search suggestions, selected record identities, returned paths, and their evidence. Ordinary Atlas and record routes do not load this worker or index. Worker disposal cancels outstanding work; stale responses cannot replace a newer selection. Searches retain the core's hop/node/edge budgets, and a budget stop is never presented as proof of no connection. Shared results paginate in groups of forty and retain parallel edge evidence.

The index may be at most 96 MiB decoded, 100,000 nodes and 250,000 admitted edges. The manifest pins exact decoded size, counts and digest. Source-reference versions are shown as cited versions only when present on the reference; current source-register versions are labeled separately.

## Browser contract

A visitor can search V-205646, select the NIST endpoint supplied by its accepted CCI reference, and see the real STIG → CCI → control path. Every step exposes its source assertion and exact evidence location. Record links open the normal record detail; source links open the existing source register. Sharing confirms success only after the clipboard write succeeds. Missing endpoints, failed downloads, invalid snapshots, unavailable workers, no result within bounds, and work-budget stops are distinct from an authoritative statement of absence.

Required tests cover the user journey, shared connections, direction, state restoration, data-load recovery, worker unavailability, clipboard outcomes and 320/375/390/768/1024/1440px layouts. New screenshots are review-only evidence until deliberately approved; do not automatically accept a new pixel baseline.

## Still open in #260

The stable cartographic base and design comparison; taxonomy/system context layers; lifecycle/source-status layers; saved snapshot change comparison; publication-level aggregation; and richer workbench handoffs remain separate acceptance work. This checkpoint must not be represented as completing those items, merged as the final redesign, or used to close #260.
