# Control Atlas Documentation

- **Owner:** Product owner
- **Status:** Canonical manifest
- **Last reviewed:** 2026-08-12
- **Supersession:** A newer approved decision must update the affected canonical document in the same change. Git history, pull requests, and releases retain history.

Only durable direction belongs in `docs/`:

| Contract | Canonical document |
| --- | --- |
| Product purpose and boundary | [Vision](vision.md) and [PRD](PRD.md) |
| Product decision rules | [Design principles](DESIGN_PRINCIPLES.md) |
| Visual system | [Design system](design/design-system.md) |
| Page composition and responsive behavior | [Page contracts](PAGE_CONTRACTS.md) |
| Runtime and component boundaries | [Architecture](architecture/ARCHITECTURE.md) |
| Sources, publisher structure, relationships, and generated data | [Data policy](DATA_POLICY.md) |
| Record-type source fidelity and semantic presentation roles | [Record type fidelity audit](RECORD_TYPE_FIDELITY_AUDIT.md) |
| Governed discovery vocabulary and applicability coverage | [Taxonomy contract](TAXONOMY.md) |
| Verification, release, and operations | [Operations](OPERATIONS.md), including the executable nine-promise assurance contract |
| CI/CD workflow architecture | [CI/CD](CI_CD.md) |
| Open work only | [Backlog](BACKLOG.md) |
| Third-party attribution | [Third-party notices](THIRD_PARTY_NOTICES.md) |

## Lifecycle rules

- Recent owner-approved direction takes precedence and must replace conflicting text rather than creating another document.
- There is exactly one backlog: `docs/BACKLOG.md`.
- `docs/Plan.md` may exist only while one initiative is active. Delete it in the shipping change.
- Do not commit dated audits, research dumps, spikes, completion reports, evidence packets, handoff state, or historical status documents. Use issues, pull requests, Actions artifacts, releases, and Git history.
- Every canonical document identifies its owner, status, last-reviewed date, and supersession rule.
