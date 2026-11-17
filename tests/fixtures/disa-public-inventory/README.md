# Historical DISA public-inventory fixture

These are test fixtures, not accepted source data.
The HTTP 200 response was captured on 2026-11-11 at 01:50:35Z using the exact
unauthenticated read action in the adapter. SHA-256 of response.json:
ea1597986b3af9cbb92db6db18acbc295eb229002383b4562459ce85c2429999.

It holds 417 rows. That count is the first accepted baseline for the automatic
completeness band in `scripts/lib/disa-public-inventory.mjs`; later accepted
runs replace it through `data/disa-artifact-manifest.json`. At capture time the
same 417 rows were also reconciled with the 28 rendered public Document Library
pages. accepted-filenames.json is filename-only coverage from the accepted
October 28 manifest: 183 current manuals in the compilation and 9 in accepted
standalone packages. No archive was downloaded or rehashed for this fixture.
The 116 explicit Sunset entries remain in the all-row fixture.

Row File-2032 lists its package as
`https://dl.dod.cyber.mil//wp-content/uploads/stigs/zip/U_Omnissa_Horizon_Y26M09_STIG.zip`.
On 2026-11-17 that link and the single-slash path returned the same object
(HTTP 200, 2,145,645 bytes, identical ETag), so the doubled slash is accepted
for folder containment while the literal link is kept.

These files must not be copied into production source evidence.
