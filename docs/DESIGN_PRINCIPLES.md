# Control Atlas Design Principles

- **Owner:** Product owner and Muse
- **Status:** Canonical
- **Last reviewed:** 2026-08-11
- **Supersession:** New approved principles replace conflicting guidance here rather than creating a parallel design document.

## Build for translation, not complexity

Every project should reduce the distance between a messy real-world problem and clear user action. The system should organize complexity into plain language, visible relationships, practical workflows, and trustworthy outputs that help users understand what matters, why it matters, and what to do next.

**Tighter version:** Build for translation, not complexity — turn messy domains, fragmented information, and expert-only language into clear, connected, trustworthy systems that help users understand the problem, make decisions, and act with confidence.

For Control Atlas, that means turning frameworks, controls, mappings, STIGs, MITRE techniques, Zero Trust concepts, and RMF artifacts into a **shared plain-language model** that small teams can understand, trust, and use.

## Build a public common resource

Control Atlas should become the federal-cybersecurity resource practitioners recommend
to one another. That ambition is earned by being useful, open, specific, traceable,
and respectful of the people doing the work. It is not earned through opaque claims,
artificial scarcity, or pretending that a reference tool can make an organization's
compliance, risk, or authorization decisions.

Design for the person who arrives overwhelmed and the practitioner who arrives with a
precise question. Give both a fast answer, a visible connection to the underlying
public source, and a practical next step.

## Operating rules for AI agents

1. **Plain language first.** Use domain terms only when they add precision.
2. **Show the connection.** Do not present isolated facts, features, tasks, or artifacts without explaining how they relate.
3. **Make action obvious.** The user should not have to perform the final synthesis.
4. **Preserve rigor.** Simplifying something must not make it less accurate, traceable, or defensible.
5. **Design for constrained teams.** Assume limited time, limited staffing, imperfect data, and competing priorities.
6. **Separate published source material from interpretation.** Make clear what is known, what is inferred, and what is recommended.
7. **Prefer usable systems over impressive systems.** A smaller workflow that people actually trust and use is better than a powerful one they avoid.
8. **Answer the task in front of the user.** Do not force every surface into a three-part explanation.

## What this means in practice (Control Atlas)

1. **Use plain operational language for product instructions.** On record pages, lead with the complete published text rather than invented guidance.
2. **Show useful connections in context.** Relationships support the task; they are not the headline or the product story on every surface.
3. **Keep evidence available without narrating it repeatedly.** Crosswalk citations, publication details, and official links provide traceability where it matters.
4. **Treat mappings as decision support, not magic automation.** Disclaimers stay visible; no compliant / not compliant framing.
5. **Help users complete the task in front of them.** Suggest a next step only when the product can support it honestly.
6. **Design for small teams without assuming dedicated compliance staff.** Progressive disclosure, short first screens, no jargon walls on entry.
7. **Preserve rigor without making the user speak in framework jargon.** Approachable entry points; depth behind search and detail views.
8. **No raw identifiers in user-facing copy.** Every `source_id`, `canonical_id`, or schema enum in a label, filter, or button must resolve through a `display_name`.

## Feature and copy review checklist

Before shipping UI copy or a new surface, confirm:

- Does it lead with plain operational language (rule 1)?
- Does it show connection, not just existence (rule 2)?
- Does it suggest a concrete next action (rule 3)?
- Is it still accurate, traceable, and defensible (rule 4)?
- Would a constrained team understand the first screen (rule 5)?
- Is published source material separated from interpretation (rule 6)?
- Is this the simplest workflow people will actually use (rule 7)?
- Does it answer the task in front of the user without invented interpretation (rule 8)?
- Can the user trace back to an authoritative source?
- Does the copy describe the job, the subject and the payoff rather than the interface? (See "Public copy" in [`PAGE_CONTRACTS.md`](PAGE_CONTRACTS.md).)

## Related docs

- Product vision: [`vision.md`](vision.md)
- Requirements: [`PRD.md`](PRD.md)
- Canonical documentation manifest: [`README.md`](README.md)
