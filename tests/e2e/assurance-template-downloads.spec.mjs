import { assertRegistryInventory } from '../../tools/lib/assurance-inventory.mjs';
import { practitionerGuides } from '../../src/app/learn-content.mjs';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { GENERATED_FILE_NOTICE, STARTER_DOCUMENT_REVIEW_NOTICE } from '../../src/shared/disclaimer.mjs';
import { dismissOnboarding, waitForAppReady } from './support.mjs';

const registry = JSON.parse(readFileSync('data/template-registry.json', 'utf8'));
assertRegistryInventory(registry.templates, practitionerGuides);
const widths = [320, 375, 390, 768, 1024, 1440];
const parser = new XMLParser();
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
for (const [index, template] of registry.templates.entries()) for (const format of template.supported_formats) {
  test(`assurance templates: ${template.template_id}:${format} downloads actual parsed bytes`, async ({ page }, info) => {
    test.setTimeout(120000);
    info.annotations.push({ type: 'assurance', description: `templates:${template.template_id}:${format}` });
    await page.setViewportSize({ width: widths[index % widths.length], height: 900 });
    await page.goto(`/#/build/documents/${template.name}?format=${format}`);
    await waitForAppReady(page);
    await dismissOnboarding(page);
    const button = page.locator('#document-download-action');
    if (template.required_input_options.length) await expect(button).toBeDisabled();
    if (template.input_options.includes('framework')) await page.getByRole('combobox', { name: /^Catalog or program/ }).selectOption('nist-800-53');
    if (template.required_input_options.includes('baseline')) await page.getByRole('combobox', { name: /^Baseline/ }).selectOption('MODERATE');
    if (template.input_options.includes('environment_archetype')) await page.getByRole('combobox', { name: /^Environment/ }).selectOption('Cloud SaaS');
    const preview = page.locator('.template-document-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(STARTER_DOCUMENT_REVIEW_NOTICE);
    const title = await preview.locator('h3').innerText();
    const headings = await preview.locator('.template-document-preview-outline li > span').allTextContents();
    await expect(button).toBeEnabled();
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const pending = page.waitForEvent('download');
      await button.click();
      const download = await pending;
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
      const path = await download.path();
      const files = unzipSync(readFileSync(path));
      const parts = Object.entries(files).filter(([name]) => name.endsWith('.xml'));
      for (const [name, bytes] of parts) expect(XMLValidator.validate(strFromU8(bytes)), name).toBe(true);
      const text = parts.flatMap(([, bytes]) => strings(parser.parse(strFromU8(bytes)))).join('\n');
      expect(text).toContain(GENERATED_FILE_NOTICE);
      expect(text).toContain(title);
      expect(text).toContain('Source Metadata');
      for (const heading of headings) expect(text).toContain(heading);
      if (format === 'xlsx') {
        const sheets = await readXlsxFile(path);
        expect(sheets.length).toBeGreaterThan(1);
        expect(sheets.some(sheet => sheet.sheet === 'Read Me')).toBe(true);
        expect(sheets.some(sheet => sheet.sheet === 'Field Guide')).toBe(true);
        // The actual exported styled working cells must be empty, not fabricated answers.
        const worksheets = parts.filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
        let blank = 0;
        for (const [, bytes] of worksheets) {
          const xml = strFromU8(bytes);
          blank += (xml.match(/<c\b[^>]*s="[4-7]"[^>]*\/>/g) ?? []).length;
          expect(xml).not.toMatch(/<c\b[^>]*s="[4-7]"[^>]*>\s*<(?:v|is)>/);
        }
        expect(blank).toBeGreaterThan(0);
      } else expect(files['word/document.xml']).toBeTruthy();
    }
    await expect(preview.locator('h3')).toHaveText(title);
  });
}
