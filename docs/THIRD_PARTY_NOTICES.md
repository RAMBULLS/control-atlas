# Third-Party and Government Source Notices

- **Owner:** Sentinel
- **Status:** Canonical
- **Last reviewed:** 2026-08-11
- **Supersession:** Dependency or attribution changes update this file in the same release.

Control Atlas catalogs authoritative government resources and open-source tools so users can reach the original source before using a companion artifact. Catalog links do not imply endorsement by the publisher, maintainer, or United States Government.

The Phase 7 registries added on 2026-07-16 contain metadata and links only. They do not vendor the referenced applications, templates, schemas, logos, or source code. If source material is incorporated later, its file-level license and notice requirements must be reviewed and preserved at that time.

## Federal sources

- **FedRAMP / General Services Administration:** Current schemas and legacy transition artifacts are linked from [FedRAMP](https://www.fedramp.gov/). FedRAMP states that its name and logo are GSA property. Legacy artifacts remain visibly labeled as legacy and are not represented as current submission guidance. See the [FedRAMP disclaimer](https://www.fedramp.gov/disclaimers/).
- **Department of Defense, DISA, and DCSA:** Public policies, guides, training, and forms are linked to official `.mil` publishers. Some related systems and materials require CAC, account, mission, or network access. Control Atlas does not redistribute restricted material or infer licenses and schemas from unofficial copies.
- **NIST OSCAL:** NIST states that the [OSCAL project](https://github.com/usnistgov/OSCAL/blob/main/LICENSE.md) is in the worldwide public domain, subject to the project's federal notices and fair-use guidance. NIST names and marks do not imply endorsement.
- **General federal-content caveat:** A file's presence on a federal website does not guarantee that every embedded element is free of third-party rights. Preserve source attribution, notices, and trademarks and review the specific artifact before redistribution.

## Open-source references

| Project | License recorded by source | Source notice |
| --- | --- | --- |
| [MITRE eMASS Client](https://github.com/mitre/emass_client) | Apache-2.0 with additional MITRE redistribution terms | Retain the repository [LICENSE](https://github.com/mitre/emass_client/blob/main/LICENSE.md) and [NOTICE](https://github.com/mitre/emass_client/blob/main/NOTICE.md) when reusing covered material. |
| [MITRE eMASSer](https://github.com/mitre/emasser) | Apache-2.0 with additional MITRE redistribution terms | Follow the repository [LICENSE](https://github.com/mitre/emasser/blob/main/LICENSE.md); do not imply MITRE endorsement. |
| [MITRE SAF CLI](https://github.com/mitre/saf) | Apache-2.0 with additional MITRE redistribution terms | Follow the repository [LICENSE](https://github.com/mitre/saf/blob/main/LICENSE.md). |
| [MITRE Heimdall](https://github.com/mitre/heimdall2) | Apache-2.0 with additional MITRE redistribution terms | Follow the repository [LICENSE](https://github.com/mitre/heimdall2/blob/master/LICENSE.md). |
| [STIG Manager Client Modules](https://github.com/NUWCDIVNPT/stig-manager-client-modules) | MIT | Follow the repository [LICENSE](https://github.com/NUWCDIVNPT/stig-manager-client-modules/blob/main/LICENSE.md). |
| [Vulnerator](https://github.com/Vulnerator/Vulnerator) | MIT | Treat its eMASS and POA&M behavior as a historical community reference until independently validated. |
| [OpenSCAP](https://github.com/OpenSCAP/openscap) | LGPL-2.1 | Follow the repository [COPYING](https://github.com/OpenSCAP/openscap/blob/main/COPYING) and file-level notices. |
| [Microsoft PowerSTIG](https://github.com/microsoft/PowerStig) | MIT | Follow the repository [LICENSE](https://github.com/microsoft/PowerStig/blob/dev/LICENSE). |
| [ComplianceAsCode Content](https://github.com/ComplianceAsCode/content) | BSD-3-Clause | Follow the repository [LICENSE](https://github.com/ComplianceAsCode/content/blob/master/LICENSE) and generated-content notices. |

## Self-hosted typography

Orbital Archive No. 01 1.8.0 supplies the IBM Plex Mono, Oswald and Silkscreen
font bytes used by the interface. Production builds extract those bytes without
modifying them, retain every declared face and weight, and publish their copyright
notices and complete SIL Open Font License 1.1 texts alongside the font assets.
The generated `assets/font-licenses/font-assets.json` maps each emitted font to
its notice and records its computed SHA256 and byte length. Orbital's MIT license
is included separately.

The committed notices preserve the complete text from Google Fonts commit
`7085eb89a950e85db5b166b7a58d414544b4140c`, with line endings and trailing
whitespace normalized to repository conventions:

- [IBM Plex Mono](../styles/font-notices/ibmplexmono-OFL.txt), from [Google Fonts](https://github.com/google/fonts/blob/7085eb89a950e85db5b166b7a58d414544b4140c/ofl/ibmplexmono/OFL.txt).
- [Oswald](../styles/font-notices/oswald-OFL.txt), from [Google Fonts](https://github.com/google/fonts/blob/7085eb89a950e85db5b166b7a58d414544b4140c/ofl/oswald/OFL.txt).
- [Silkscreen](../styles/font-notices/silkscreen-OFL.txt), from [Google Fonts](https://github.com/google/fonts/blob/7085eb89a950e85db5b166b7a58d414544b4140c/ofl/silkscreen/OFL.txt).

## Interoperability wording

Control Atlas uses the following evidence labels and does not collapse them into a generic “compatible” claim:

- `official_current`: published by the responsible authority as current.
- `official_legacy`: published by the responsible authority but explicitly retained for legacy or transition use.
- `official_guidance`: an official policy, guide, training resource, or documented interchange behavior.
- `schema_aligned`: shaped against a named public schema version, without claiming receiving-system acceptance.
- `community_reference`: useful open-source behavior or format evidence that is not an official contract.
- `unverified`: access, license, format, or receiving-system behavior could not be independently verified.

Successful validation against a schema or successful generation of a file is not evidence of authorization, approval, certification, or import into a target federal system.
