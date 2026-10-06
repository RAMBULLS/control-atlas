type AtlasSearchDocument = {
  id: string;
  item_id?: string;
  title?: string;
};

type AtlasSearchRuntime = {
  searchLibrary: (query: string) => AtlasSearchDocument[];
};

export type AtlasSearchTransition =
  | {
      kind: "focus";
      nodeId: string;
      query: string;
      announcement: string;
    }
  | {
      kind: "search";
      query: string;
      announcement: string;
    }
  | {
      kind: "no-match";
      query: string;
      announcement: string;
    };

function resolveControlAliases(rawNeedle: string): string[] {
  if (!rawNeedle) return [];
  const trimmed = rawNeedle.trim();
  if (!trimmed) return [];

  const aliases = new Set<string>();
  aliases.add(trimmed.toUpperCase());

  const strippedPrefix = trimmed
    .replace(/^(?:nist\s*800-53|sp\s*800-53|nist|rev\s*5|disa|dod)\s+/i, "")
    .trim();
  if (strippedPrefix) {
    aliases.add(strippedPrefix.toUpperCase());
  }

  const candidateInputs = [trimmed, strippedPrefix].filter(Boolean);

  for (const input of candidateInputs) {
    const cciMatch = input.match(/^(?:cci[-\s]*)0*(\d{1,6})$/i);
    if (cciMatch) {
      const num = Number.parseInt(cciMatch[1], 10);
      if (!Number.isNaN(num) && num > 0) {
        aliases.add(`CCI-${String(num).padStart(6, "0")}`);
      }
    }

    const attackMatch = input.match(/^(t\d{4})[/\-\s](\d{3})$/i);
    if (attackMatch) {
      aliases.add(`${attackMatch[1].toUpperCase()}.${attackMatch[2]}`);
    }

    const parenMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)\s*\(\s*0*(\d+)\s*\)/i);
    if (parenMatch) {
      const family = parenMatch[1].toUpperCase();
      const controlNum = Number.parseInt(parenMatch[2], 10);
      const enhNum = Number.parseInt(parenMatch[3], 10);
      aliases.add(`${family}-${controlNum}.${enhNum}`);
      aliases.add(`${family}-${controlNum}`);
    }

    const dotMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)\.0*(\d+)/i);
    if (dotMatch) {
      const family = dotMatch[1].toUpperCase();
      const controlNum = Number.parseInt(dotMatch[2], 10);
      const enhNum = Number.parseInt(dotMatch[3], 10);
      aliases.add(`${family}-${controlNum}.${enhNum}`);
      aliases.add(`${family}-${controlNum}`);
    }

    const csfMatch = input.match(/^([a-z]{2})[.\-\s]([a-z]{2})[-\s]?0*(\d+)$/i);
    if (csfMatch) {
      const func = csfMatch[1].toUpperCase();
      const cat = csfMatch[2].toUpperCase();
      const num = Number.parseInt(csfMatch[3], 10);
      aliases.add(`${func}.${cat}-${num}`);
    }

    const stigVulnMatch = input.match(/^v[-\s]?(\d{4,7})$/i);
    if (stigVulnMatch) {
      aliases.add(`V-${stigVulnMatch[1]}`);
    }
    const bareVulnMatch = input.match(/^(\d{5,7})$/);
    if (bareVulnMatch) {
      aliases.add(`V-${bareVulnMatch[1]}`);
    }
    const svMatch = input.match(/^sv[-\s]?(\d{4,7})/i);
    if (svMatch) {
      aliases.add(`V-${svMatch[1]}`);
    }
    const stigIdMatch = input.match(/^([a-z0-9]{2,8})[-\s_]+([a-z0-9]{2,8})[-\s_]+([a-z0-9]{4,10})$/i);
    if (stigIdMatch) {
      aliases.add(`${stigIdMatch[1].toUpperCase()}-${stigIdMatch[2].toUpperCase()}-${stigIdMatch[3].toUpperCase()}`);
    }

    const baseMatch = input.match(/^([a-z]{2,4})[-\s]?0*(\d+)$/i);
    if (baseMatch) {
      const family = baseMatch[1].toUpperCase();
      const controlNum = Number.parseInt(baseMatch[2], 10);
      aliases.add(`${family}-${controlNum}`);
    }
  }

  return [...aliases];
}

function normalizedIdentifier(value: string) {
  return value.trim().toLocaleUpperCase();
}

export function resolveAtlasSearchTransition(
  runtime: AtlasSearchRuntime,
  rawQuery: string,
): AtlasSearchTransition {
  const query = rawQuery.trim();
  const results = runtime.searchLibrary(query);
  const aliases = resolveControlAliases(query);
  const exact = results.filter(
    (entry) =>
      aliases.includes(normalizedIdentifier(entry.id)) ||
      aliases.includes(normalizedIdentifier(entry.item_id || "")),
  );

  if (exact.length === 1) {
    const itemId = exact[0].item_id || query;
    return {
      kind: "focus",
      nodeId: exact[0].id,
      query,
      announcement: `Opening ${itemId} in the focused Atlas.`,
    };
  }
  if (results.length > 0) {
    return {
      kind: "search",
      query,
      announcement: `Showing search results for ${query}.`,
    };
  }
  return {
    kind: "no-match",
    query,
    announcement: `No Atlas record matches ${query}. Try Search or browse the Library.`,
  };
}
