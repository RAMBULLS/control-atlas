// tests/disa-publication-reconciliation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDisaZip,
  parseCandidateFilename,
  compareDisaVersions,
  groupAndSelectCurrentPublications,
  reconcilePublicationInventory,
  dedupeDisaRecords,
  EXCLUSION_REASONS,
} from '../scripts/lib/disa-publication-reconciliation.mjs';

test('classifyDisaZip correctly identifies non-candidate classes and candidate packages', () => {
  assert.deepEqual(classifyDisaZip('U_SRG-STIG_Library_July_2026.zip'), {
    category: 'compilation',
    reason: EXCLUSION_REASONS.HISTORICAL_COMPILATION,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_RHEL_9_V1R2_Ansible.zip'), {
    category: 'automation',
    reason: EXCLUSION_REASONS.AUTOMATION_CONTENT,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_MS_Windows_10_V3R4_STIG_SCAP_1-3_Benchmark.zip'), {
    category: 'scap',
    reason: EXCLUSION_REASONS.SCAP_BENCHMARK,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('STIGViewer_2-17_Linux.zip'), {
    category: 'tooling',
    reason: EXCLUSION_REASONS.TOOLING_OR_SPEC,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_MS_Windows_11_STIG_GPO_Package_V2R2.zip'), {
    category: 'supplemental',
    reason: EXCLUSION_REASONS.SUPPLEMENTAL_POLICY_DOC,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_MS_Windows_Server_2019_STIG_Overview.zip'), {
    category: 'supplemental',
    reason: EXCLUSION_REASONS.SUPPLEMENTAL_POLICY_DOC,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_Sunset_Compilations_2026.zip'), {
    category: 'sunset',
    reason: EXCLUSION_REASONS.SUNSET_COMPILATION,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_Draft_Benchmark_V1R1.zip'), {
    category: 'draft',
    reason: EXCLUSION_REASONS.DRAFT_PUBLICATION,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_CUI_Network_STIG_V1R1.zip'), {
    category: 'cui',
    reason: EXCLUSION_REASONS.RESTRICTED_CUI,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('not_a_zip.txt'), {
    category: 'ignored',
    reason: EXCLUSION_REASONS.NON_ZIP_RESOURCE,
    isCandidate: false,
  });

  assert.deepEqual(classifyDisaZip('U_MS_Windows_Server_2019_V3R9_STIG.zip'), {
    category: 'candidate',
    isCandidate: true,
  });
});

test('parseCandidateFilename extracts structured version and publication metadata', () => {
  const win2019 = parseCandidateFilename('U_MS_Windows_Server_2019_V3R9_STIG.zip');
  assert.deepEqual(win2019, {
    filename: 'U_MS_Windows_Server_2019_V3R9_STIG.zip',
    family: 'MS_Windows_Server_2019',
    versionType: 'VR',
    versionMajor: 3,
    release: 9,
    versionStr: 'V3R9',
    kind: 'stig',
    suffix: 'STIG',
  });

  const ubuntu = parseCandidateFilename('U_Canonical_Ubuntu_20-04_LTS_V2R4_STIG.zip');
  assert.equal(ubuntu.family, 'Canonical_Ubuntu_20-04_LTS');
  assert.equal(ubuntu.versionStr, 'V2R4');
  assert.equal(ubuntu.kind, 'stig');

  const srg = parseCandidateFilename('U_General_Purpose_Operating_System_SRG_V2R5.zip');
  assert.equal(srg.kind, 'srg');
  assert.equal(srg.versionStr, 'V2R5');

  const containerSrg = parseCandidateFilename('U_Container_Platform_SRG_Y26M07.zip');
  assert.deepEqual(containerSrg, {
    filename: 'U_Container_Platform_SRG_Y26M07.zip',
    family: 'Container_Platform_SRG',
    versionType: 'YM',
    year: 26,
    month: 7,
    versionStr: 'Y26M07',
    kind: 'srg',
    suffix: '',
  });

  const ivanti = parseCandidateFilename('U_Ivanti_MI_Sentry_9-x_STIG.zip');
  assert.equal(ivanti.family, 'Ivanti_MI_Sentry_9-x');
  assert.equal(ivanti.versionStr, 'V1R0');
  assert.equal(ivanti.kind, 'stig');

  assert.equal(parseCandidateFilename('U_RHEL_9_V1R2_Ansible.zip'), null);
});

test('compareDisaVersions handles numeric multi-digit version ordering', () => {
  const v3r9 = { versionType: 'VR', versionMajor: 3, release: 9, versionStr: 'V3R9' };
  const v3r10 = { versionType: 'VR', versionMajor: 3, release: 10, versionStr: 'V3R10' };
  const v2r15 = { versionType: 'VR', versionMajor: 2, release: 15, versionStr: 'V2R15' };

  assert.ok(compareDisaVersions(v3r10, v3r9) > 0, 'V3R10 must be newer than V3R9');
  assert.ok(compareDisaVersions(v3r9, v3r10) < 0, 'V3R9 must be older than V3R10');
  assert.ok(compareDisaVersions(v3r9, v2r15) > 0, 'V3R9 must be newer than V2R15');

  const y26m07 = { versionType: 'YM', year: 26, month: 7, versionStr: 'Y26M07' };
  const y26m04 = { versionType: 'YM', year: 26, month: 4, versionStr: 'Y26M04' };
  const y25m10 = { versionType: 'YM', year: 25, month: 10, versionStr: 'Y25M10' };

  assert.ok(compareDisaVersions(y26m07, y26m04) > 0, 'Y26M07 must be newer than Y26M04');
  assert.ok(compareDisaVersions(y26m04, y25m10) > 0, 'Y26M04 must be newer than Y25M10');
});

test('groupAndSelectCurrentPublications selects newest canonical and marks older as superseded', () => {
  const filenames = [
    'U_MS_Windows_Server_2019_V3R8_STIG.zip',
    'U_MS_Windows_Server_2019_V3R9_STIG.zip',
    'U_MS_Windows_Server_2019_V3R7_STIG.zip',
    'U_Canonical_Ubuntu_20-04_LTS_V2R4_STIG.zip',
    'U_SRG-STIG_Library_July_2026.zip',
    'U_RHEL_9_V1R2_Ansible.zip',
  ];

  const result = groupAndSelectCurrentPublications(filenames);

  assert.equal(result.currentPublications.length, 2);
  const win2019 = result.currentPublications.find((p) => p.family === 'MS_Windows_Server_2019');
  assert.ok(win2019);
  assert.equal(win2019.filename, 'U_MS_Windows_Server_2019_V3R9_STIG.zip');

  assert.equal(result.supersededPublications.length, 2);
  assert.ok(result.supersededPublications.every((p) => p.supersededBy === 'U_MS_Windows_Server_2019_V3R9_STIG.zip'));

  assert.equal(result.excludedByRule.length, 2);
  assert.ok(result.excludedByRule.some((e) => e.reason === EXCLUSION_REASONS.HISTORICAL_COMPILATION));
  assert.ok(result.excludedByRule.some((e) => e.reason === EXCLUSION_REASONS.AUTOMATION_CONTENT));
});

test('reconcilePublicationInventory cleanly separates compilation-represented vs missing standalone', () => {
  const currentPublications = [
    { filename: 'U_RHEL_9_V1R4_STIG.zip', family: 'RHEL_9', kind: 'stig', versionStr: 'V1R4' },
    { filename: 'U_MS_Windows_Server_2019_V3R9_STIG.zip', family: 'MS_Windows_Server_2019', kind: 'stig', versionStr: 'V3R9' },
  ];

  // Compilation only contains RHEL 9, omits Windows Server 2019
  const compilationInnerZips = new Set(['U_RHEL_9_V1R4_STIG.zip']);

  const reconciliation = reconcilePublicationInventory(currentPublications, compilationInnerZips);

  assert.equal(reconciliation.expectedCount, 2);
  assert.equal(reconciliation.representedInCompilation.length, 1);
  assert.equal(reconciliation.representedInCompilation[0].filename, 'U_RHEL_9_V1R4_STIG.zip');

  assert.equal(reconciliation.standaloneNeeded.length, 1);
  assert.equal(reconciliation.standaloneNeeded[0].filename, 'U_MS_Windows_Server_2019_V3R9_STIG.zip');
});

test('dedupeDisaRecords retains newest version on overlap and sorts deterministically', () => {
  const older = {
    id: 'V-205646',
    type: 'stig_rule',
    source: { version: 'V3R8' },
    metadata: { benchmark_id: 'Windows_Server_2019_STIG' },
  };
  const newer = {
    id: 'V-205646',
    type: 'stig_rule',
    source: { version: 'V3R9' },
    metadata: { benchmark_id: 'Windows_Server_2019_STIG' },
  };
  const other = {
    id: 'V-205647',
    type: 'stig_rule',
    source: { version: 'V3R9' },
    metadata: { benchmark_id: 'Windows_Server_2019_STIG' },
  };

  const deduped = dedupeDisaRecords([older, other, newer]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'V-205646');
  assert.equal(deduped[0].source.version, 'V3R9');
  assert.equal(deduped[1].id, 'V-205647');
});
