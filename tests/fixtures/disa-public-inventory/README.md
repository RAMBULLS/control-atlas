# Historical DISA public-inventory fixture

These are test fixtures, not accepted source data or a production witness.
The HTTP 200 response was captured on 2026-11-11 at 01:50:35Z using the exact
unauthenticated read action in the adapter. SHA-256 of response.json:
ea1597986b3af9cbb92db6db18acbc295eb229002383b4562459ce85c2429999.

All 417 API records were independently reconciled with 28 rendered public
Document Library pages. witness.json preserves their exact displayed tuples,
continuous ranges, final-page completion and the canonical full-row digest.
Its historical time is the completion mtime of the retained UI capture artifact,
not an invented current publisher timestamp. Raw capture artifact hashes are
retained in the witness. accepted-filenames.json is filename-only coverage from
the accepted October 28 manifest: 183 current manuals in the compilation and 9
in accepted standalone packages. No archive was downloaded or rehashed for this
fixture. The 116 explicit Sunset entries remain in the all-row fixture.

Production admission of an independently reviewed witness is a separate step.
These files must not be copied automatically into production source evidence.
