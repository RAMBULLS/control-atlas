/**
 * FedRAMP control context (`control_context`) records publish parameter values
 * and guidance for one NIST SP 800-53 control. FedRAMP writes the parameters in
 * OSCAL notation ("ac-06.01_odp.02: all functions ..."), which is machine
 * vocabulary. These helpers read that notation so the page can lead with the
 * control a practitioner knows (AC-6.1, parameter 2) and keep the publisher's
 * identifier as a secondary detail. Nothing is dropped: text that is not in
 * parameter notation stays as guidance, in order.
 */

const CONTEXT_ID = /^CTL-([A-Z]{2})-(\d+)(?:-(\d+))?$/;
const PARAMETER_LINE = /^([a-z]{2})-(\d+)(?:\.(\d+))?_odp(?:\.(\d+))?:\s*([\s\S]+)$/;

/** "CTL-AC-06-01" -> "AC-6.1", "CTL-AC-20" -> "AC-20"; null when the id is not a control context id. */
export function controlContextLabel(itemId) {
  const match = CONTEXT_ID.exec(String(itemId || "").trim());
  if (!match) return null;
  const control = `${match[1]}-${Number(match[2])}`;
  return match[3] === undefined ? control : `${control}.${Number(match[3])}`;
}

/** The SP 800-53 control node this context is published for, e.g. "nist-800-53:AC-6.1". */
export function controlContextTargetId(itemId) {
  const label = controlContextLabel(itemId);
  return label ? `nist-800-53:${label}` : null;
}

/**
 * Split published context text into ordered entries.
 * - parameter: { kind, label, id, value }   label is "AC-6.1 parameter 2"
 * - guidance:  { kind, text }               everything else, verbatim
 */
export function parseControlContext(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = PARAMETER_LINE.exec(chunk);
      if (!match) return { kind: "guidance", text: chunk };
      const control = `${match[1].toUpperCase()}-${Number(match[2])}${match[3] === undefined ? "" : `.${Number(match[3])}`}`;
      const number = match[4] === undefined ? "" : ` ${Number(match[4])}`;
      return {
        kind: "parameter",
        label: `${control} parameter${number}`,
        id: chunk.slice(0, chunk.indexOf(":")),
        value: match[5].trim(),
      };
    });
}
