/**
 * The one rule for printing a recorded publisher. Kept in its own tiny module
 * so every surface can use it without pulling the publication-identity data
 * (Atlas geography, authority spine) into the entry bundle.
 */
const PUBLISHER_DISPLAY_NAMES: Record<string, string> = { dod: "Department of Defense" };

/** Short practitioner form of a recorded publisher; "dod" reads as the department. */
export function publisherDisplayName(value: unknown): string {
  const recorded = typeof value === "string" ? value.trim() : "";
  if (!recorded) return "";
  return PUBLISHER_DISPLAY_NAMES[recorded.toLocaleLowerCase()] || recorded;
}
