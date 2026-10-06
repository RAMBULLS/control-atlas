import assert from "node:assert/strict";
import test from "node:test";

import { learnArticles, practitionerGuides } from "../src/app/learn-content.mjs";
import sourceRegistry from "../data/source-registry.json" with { type: "json" };

test("every Learn article is a cited Control Atlas explanation with boundaries", () => {
  assert.equal(learnArticles.length, 6);
  for (const article of learnArticles) {
    assert.ok(article.title, article.id);
    assert.ok(article.summary, article.id);
    assert.ok(article.explanation, article.id);
    assert.ok(article.limitations, article.id);
    assert.ok(article.nextAction?.label, article.id);
    assert.ok(article.nextAction?.view, article.id);
    assert.ok(article.citations.length > 0, article.id);
    for (const citation of article.citations) {
      assert.match(citation.url, /^https:\/\/(?:csrc\.nist\.gov|www\.nist\.gov)\//);
      assert.equal(citation.role, "official-subject-source");
      assert.ok(citation.supports, `${article.id} citation needs a support note`);
      const source = sourceRegistry.sources.find(
        (entry) => entry.id === citation.sourceId,
      );
      assert.ok(source, `${article.id} citation source must exist`);
      assert.equal(citation.url, source.artifact_url);
    }
    assert.doesNotMatch(
      `${article.title} ${article.summary} ${article.explanation} ${article.limitations}`,
      /\b(new user|novice|beginner|recommended for)\b/i,
    );
  }
});

test("every practitioner guide answers a real work question with a verified citation", () => {
  assert.equal(practitionerGuides.length, 11);
  const sourceIds = new Set(sourceRegistry.sources.map((entry) => entry.id));
  for (const article of practitionerGuides) {
    assert.equal(article.kind, "practitioner", article.id);
    assert.ok(article.title, article.id);
    assert.ok(article.summary, article.id);
    assert.ok(article.whereItSits, article.id);
    assert.ok(article.whenItMatters, article.id);
    assert.ok(article.explanation, article.id);
    assert.ok(article.limitations, article.id);
    assert.ok(article.goal, `${article.id} needs a procedural goal`);
    assert.ok(article.prerequisites.length > 0, `${article.id} needs prerequisites`);
    assert.ok(article.steps.length >= 3, `${article.id} needs an actionable sequence`);
    for (const step of article.steps) {
      assert.ok(step.title, `${article.id} step needs a title`);
      assert.ok(step.action, `${article.id} step needs an action`);
    }
    assert.ok(article.output, `${article.id} needs an expected output`);
    assert.ok(article.validation.length > 0, `${article.id} needs handoff checks`);
    assert.ok(article.nextAction?.label, article.id);
    assert.ok(article.nextAction?.view, article.id);
    assert.ok(article.citations.length > 0, article.id);
    for (const citation of article.citations) {
      // Citation URLs point to the human-readable landing page for the
      // publication, which is not always identical to the machine-readable
      // artifact_url ingested from the same source — but the sourceId must
      // be a real, ingested source, and the URL must be a real federal
      // publication domain, never fabricated.
      assert.ok(
        sourceIds.has(citation.sourceId),
        `${article.id} citation sourceId '${citation.sourceId}' must be a real ingested source`,
      );
      assert.match(
        citation.url,
        /^https:\/\/(?:csrc\.nist\.gov|www\.nist\.gov|www\.cyber\.mil|www\.fedramp\.gov)\//,
        `${article.id} citation URL must be an authoritative federal domain`,
      );
      assert.equal(citation.role, "official-subject-source", article.id);
      assert.ok(citation.supports, `${article.id} citation needs a support note`);
    }
    assert.doesNotMatch(
      `${article.title} ${article.summary} ${article.explanation} ${article.limitations}`,
      /\b(new user|novice|beginner|recommended for)\b/i,
    );
  }
});

test("guide handoffs open the named working file instead of the Templates entrance", () => {
  const expected = {
    "managing-findings": "poam_starter",
    "continuous-monitoring": "conmon_calendar",
    "inheritance-and-common-controls": "inheritance_worksheet",
    reciprocity: "reciprocity_checklist",
  };
  for (const [id, templateType] of Object.entries(expected)) {
    const guide = practitionerGuides.find((article) => article.id === id);
    assert.equal(guide.nextAction.view, "templates");
    assert.equal(guide.nextAction.patch.templateType, templateType);
  }
});
