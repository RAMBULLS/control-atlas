import { useEffect, useRef, useState } from "react";
import { AtlasResearchClient } from "./atlasResearchClient";
import type { ResearchAnswer, ResearchManifest, ResearchRecord } from "./atlasResearchIndex";

export type ResearchRequest =
  | { kind: "upstream"; from: string; catalogs: readonly string[]; maxHops: number }
  | { kind: "path"; from: string; to: string; direction: "forward" | "either"; maxHops: number }
  | { kind: "shared"; pins: readonly string[] };

export type TerritoryResearch = {
  status: "idle" | "loading" | "ready" | "error";
  working: boolean;
  failed: boolean;
  answer: ResearchAnswer | null;
  records: Map<string, ResearchRecord>;
  degree: Map<string, number>;
  retry: () => void;
};

/**
 * Owns the research worker for the mounted Atlas only. The 67 MB connection index is fetched when a
 * record is focused or a record-level question is asked, never on first paint. A failure is reported
 * as a failure, never as "no connection".
 */
export function useTerritoryResearch(enabled: boolean, request: ResearchRequest | null, recordIds: readonly string[]): TerritoryResearch {
  const client = useRef<AtlasResearchClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<TerritoryResearch["status"]>("idle");
  const [records, setRecords] = useState<Map<string, ResearchRecord>>(new Map());
  const [degree, setDegree] = useState<Map<string, number>>(new Map());
  const [answer, setAnswer] = useState<{ key: string; value: ResearchAnswer } | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestKey = request ? JSON.stringify(request) : "";
  const idsKey = recordIds.join("|");

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let session: AtlasResearchClient;
    try { session = new AtlasResearchClient(); } catch { setStatus("error"); return undefined; }
    client.current = session;
    setStatus("loading"); setFailed(false);
    session.request<ResearchManifest>({ kind: "load", url: new URL("./data/generated/atlas-research-manifest.json", window.location.href).href })
      .then(() => { if (active) setStatus("ready"); })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; session.dispose(); client.current = null; setStatus("idle"); };
  }, [enabled, attempt]);

  useEffect(() => {
    if (status !== "ready" || !recordIds.length) return undefined;
    let active = true;
    const ids = [...new Set(recordIds)].slice(0, 8);
    client.current!.request<ResearchRecord[]>({ kind: "records", ids }).then((rows) => {
      if (active) setRecords((cur) => new Map([...cur, ...rows.map((r) => [r.id, r] as const)]));
    }).catch(() => { if (active) setFailed(true); });
    for (const id of ids) {
      client.current!.request<number>({ kind: "degree", id }).then((n) => { if (active) setDegree((cur) => new Map(cur).set(id, n)); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [status, idsKey, attempt]);

  useEffect(() => {
    setAnswer(null); setFailed(false);
    if (status !== "ready" || !request) { setWorking(false); return undefined; }
    let active = true;
    setWorking(true);
    const command = request.kind === "upstream" ? { kind: "upstream" as const, from: request.from, catalogs: [...request.catalogs], maxHops: request.maxHops }
      : request.kind === "path" ? { kind: "path" as const, from: request.from, to: request.to, direction: request.direction, maxHops: request.maxHops }
        : { kind: "shared" as const, pins: [...request.pins], offset: 0 };
    client.current!.request<ResearchAnswer>(command).then((value) => {
      if (!active) return;
      setAnswer({ key: requestKey, value }); setWorking(false);
      setRecords((cur) => new Map([...cur, ...value.nodes.map((r) => [r.id, r] as const)]));
    }).catch(() => { if (active) { setWorking(false); setFailed(true); } });
    return () => { active = false; };
  }, [status, requestKey, attempt]);

  return {
    status, working, failed: failed || status === "error", answer: answer?.key === requestKey ? answer.value : null,
    records, degree, retry: () => setAttempt((n) => n + 1),
  };
}
