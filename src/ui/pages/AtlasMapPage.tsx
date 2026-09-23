import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  IconChevronRight,
  IconFolderOpen,
  IconListDetails,
  IconMap,
  IconRoute,
  IconSearch,
} from "@tabler/icons-react";

import { displayNameFor } from "../../app/display-names.mjs";
import { retiresIntoAtlas } from "../../shared/record-acceptance.mjs";
import {
  recordPresentationContract,
  SUPPORTED_RECORD_TYPES,
} from "../../shared/record-presentation.mjs";
import { FIRST_PAINT_ROUTE_COPY, SITE_COPY } from "../../shared/site-copy.mjs";
import { AcronymText } from "../components/AccessibleTerm";
import { AtlasConnectionMap } from "../components/AtlasConnectionMap";
import { AtlasAreaMap, type AtlasAreaNode } from "../components/AtlasAreaMap";
import { withUnitNoun } from "../lib/atlasUnits";
import {
  AtlasDetailPanel,
  type AtlasPanelSubject,
} from "../components/AtlasDetailPanel";
import {
  ATLAS_LENS_LABELS,
  jobFamiliesFor,
  kindFamiliesFor,
  publicationsWithoutPublisher,
  publisherFamiliesFor,
  publisherStrips,
} from "../lib/atlasLensFamilies";
import { AtlasDecompositionMap } from "../components/AtlasDecompositionMap";
import { AtlasFrameworkLinks } from "../components/AtlasFrameworkLinks";
import { AtlasLensBar } from "../components/AtlasLensBar";
import { AtlasPivotTrailBar } from "../components/AtlasPivotTrailBar";
import {
  atlasProjectionRecordLabels,
  frameworkDependencyParent,
  type AtlasProjectionDrill,
} from "../lib/atlasGraphProjection";
import {
  describePivotTrail,
  parsePivotTrail,
  pushPivot,
  truncatePivotTrail,
} from "../lib/atlasPivotTrail";
import {
  AtlasTree,
  structuralChildrenFromNeighborhood,
} from "../components/AtlasTree";
import { RelationshipGraphTable } from "../components/RelationshipGraphTable";
import { WhereThisSitsRail } from "../components/WhereThisSitsRail";
import {
  ATLAS_RELATIONSHIP_LENSES,
  atlasFilterOptions,
  buildAtlasContextGroups,
  buildAtlasContextRows,
  buildStructuralChildren,
  summarizeAtlasRelationshipScopes,
  type AtlasFilterState,
  type AtlasRelationshipRow,
} from "../lib/atlasModel";
import {
  buildAtlasBootstrapModel,
  buildAtlasDrilldownModel,
  hydrateAtlasFrameworkRecords,
  type AtlasDrilldownModel,
} from "../lib/atlasDrilldown";
import { resolveAtlasSearchTransition } from "../lib/atlasSearch";
import { scrollElementBelowHeader } from "../lib/pagePrimitives";
import { relationshipExplanation } from "../lib/relationshipProvenance";
import { areaPresentationForCatalog } from "../lib/areaVisualLanguage";
import {
  catalogDisplayNameFor,
  catalogProfileFor,
  catalogShortNameFor,
} from "../lib/catalogProfiles";
import {
  officialSourceActionLabel,
  officialSourceFor,
} from "../lib/officialSource";
import {
  loadAtlasNeighborhood,
  loadAtlasNetworkDetails,
  selectAtlasStructuralPath,
  type AtlasNeighborhoodRecord,
  type AtlasNetworkDetails,
  type RuntimeBundle,
} from "../lib/runtimeLoader";
import { runtimeRecordIdentityFor } from "../lib/runtimeRecordIdentity";
import { nodeIdFromItemId, type ViewState } from "../lib/viewState";

import { Button, ButtonLink } from "../components/lsm";
import { AppLink, shouldInterceptAppLink } from "../components/AppLink";
import { RecordLink } from "../components/RecordLink";
import {
  publishedSectionsWithContent,
  RecordPublishedTextPreview,
} from "../components/RecordPublishedText";

type AtlasMapPageProps = {
  bundle: RuntimeBundle;
  state: Extract<ViewState, { view: "atlas-map" }>;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
  onOpenNode: (nodeId: string) => void;
};

type AtlasView = "path" | "map" | "list";

function atlasView(value: string, focused: boolean): AtlasView {
  // "purpose"/"rmf" are legacy view ids: both opened the hierarchy under a
  // different lens, so they resolve to "path" and keep old links working.
  if (value === "purpose" || value === "rmf") {
    return "path";
  }
  // Map draws the connections OF a selected record, so with no record it can
  // only ever be a dead end. A bookmarked or shared `?relationshipView=map`
  // link with no record resolves to the board instead of stranding the
  // visitor. List is unaffected: it renders the source inventory, which does
  // not depend on a selected record.
  if (value === "map" && !focused) {
    return "path";
  }
  if (["path", "map", "list"].includes(value)) {
    return value as AtlasView;
  }
  // A focused record opens on Connections with both panels closed — that is
  // the workspace. Only an explicit ?relationshipView=path|list opens one.
  return focused ? "map" : "path";
}

function useCompactAtlas() {
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return compact;
}

function requestedNodeId(bundle: RuntimeBundle, rawNode: string) {
  const node = rawNode.trim();
  if (!node || node === "foundation" || node === "landscape") return "";
  if (node.startsWith("hierarchy:")) return "";
  const resolved = nodeIdFromItemId(bundle.runtime, node);
  if (resolved) return resolved;
  return node.includes(":") ? node : "";
}

function focusedAtlasTitle(bundle: RuntimeBundle, record: AtlasNeighborhoodRecord) {
  return runtimeRecordIdentityFor(
    bundle,
    record.center_node.id,
    record.center_node,
  ).primary || "Selected record";
}

function formatPanelCount(count: number): string {
  return Math.max(0, count).toLocaleString("en-US");
}

export function AtlasMapPage(props: AtlasMapPageProps) {
  const {
    bundle: loadedBundle,
    state,
    onNavigate,
    onOpenNode,
  } = props;

  // The board draws from the landing projection; the drilldown half arrives
  // behind it. Until it does, `details` and `record_locations` read as empty,
  // which every consumer already guards for. Merging here means nothing below
  // has to know the artifact came in two pieces.
  const [atlasDetails, setAtlasDetails] = useState<AtlasNetworkDetails | null>(null);
  useEffect(() => {
    if (!loadedBundle.atlasNetwork || atlasDetails) return;
    let cancelled = false;
    const start = () => {
      void loadAtlasNetworkDetails()
        .then((loaded) => {
          if (!cancelled) setAtlasDetails(loaded);
        })
        .catch(() => {
          // A drilldown retries; the board itself stays usable without this.
        });
    };
    // A link that already names a group, framework or record is a request for
    // the drilldown, so it is fetched at once. Only the bare landing defers:
    // there, starting this beside the board's own fetches would put the
    // drilldown corpus in front of the five cards the reader actually asked
    // for, which on a constrained connection is the whole difference.
    const drilled = Boolean(
      state.node
        || state.atlasFamily
        || state.atlasFramework
        || state.atlasBenchmark
        || state.atlasLimb
        || state.atlasPivotTrail,
    );
    if (drilled) {
      start();
      return () => {
        cancelled = true;
      };
    }
    const idle = window.requestIdleCallback;
    const handle = idle
      ? idle(start, { timeout: 2000 })
      : window.setTimeout(start, 300);
    return () => {
      cancelled = true;
      if (idle && window.cancelIdleCallback) window.cancelIdleCallback(handle as number);
      else window.clearTimeout(handle as number);
    };
  }, [
    loadedBundle.atlasNetwork,
    atlasDetails,
    state.node,
    state.atlasFamily,
    state.atlasFramework,
    state.atlasBenchmark,
    state.atlasLimb,
    state.atlasPivotTrail,
  ]);

  const bundle = useMemo(() => {
    if (!loadedBundle.atlasNetwork) return loadedBundle;
    // Always present, even before the fetch lands: several readers index these
    // directly, and an absent map is a render crash rather than an empty one.
    return {
      ...loadedBundle,
      atlasNetwork: {
        ...loadedBundle.atlasNetwork,
        details: atlasDetails?.details || {},
        record_locations: atlasDetails?.record_locations || {},
      },
    };
  }, [loadedBundle, atlasDetails]);

  const compact = useCompactAtlas();
  const nodeId = useMemo(
    () => requestedNodeId(bundle, state.node),
    [bundle, state.node],
  );
  const view = atlasView(state.relationshipView, Boolean(nodeId));
  // The publisher hierarchy is a deliberate alternate projection. Area and
  // publication route state now drives the semantic Sigma projection instead
  // of suppressing it and falling back to a tree by default.
  const hierarchyRequested = Boolean(
    state.relationshipView
      || state.atlasAxis === "framework"
      || state.atlasAxis === "process"
      || state.sourceView === "rmf",
  );
  const atlasProjection = useMemo(() => {
    const artifact = bundle.atlasNetwork;
    if (!artifact) return null;
    if (state.atlasFamily && artifact.details[state.atlasFamily]) {
      return artifact.details[state.atlasFamily];
    }
    if (state.atlasFramework && artifact.publications[state.atlasFramework]) {
      return artifact.publications[state.atlasFramework];
    }
    if (state.atlasLimb && (artifact.ecosystems[state.atlasLimb] || artifact.areas[state.atlasLimb])) {
      return artifact.ecosystems[state.atlasLimb] || artifact.areas[state.atlasLimb];
    }
    return artifact.landscape;
  }, [bundle.atlasNetwork, state.atlasFamily, state.atlasFramework, state.atlasLimb]);
  const atlasScope = useMemo(
    () => ({
      areaId: state.atlasLimb || "",
      publicationId: state.atlasFramework || "",
      detailId: state.atlasFamily || "",
    }),
    [state.atlasLimb, state.atlasFramework, state.atlasFamily],
  );

  // The groups the current lens offers, over whichever publications this
  // artifact actually carries. Membership comes from the curated lens file;
  // tests/graph/atlasLensFamilies asserts no publication falls out of either
  // authored grouping.
  const lensCatalogIds = useMemo(
    () =>
      (bundle.atlasNetwork?.frameworks?.nodes || []).map((node) => node.publicationId),
    [bundle.atlasNetwork],
  );
  // Publisher membership comes from the artifact rather than the curated file:
  // who issued a document is a fact the build already records.
  const publisherEcosystems = useMemo(
    () =>
      Object.entries(bundle.atlasNetwork?.ecosystems || {}).map(([id, projection]) => ({
        id,
        label: projection.label,
        catalogIds: projection.nodes.map((node) => node.publicationId),
      })),
    [bundle.atlasNetwork],
  );
  const lensFamilies = useMemo(() => {
    if (!lensCatalogIds.length) return [];
    if (state.atlasLanding === "job") return jobFamiliesFor(lensCatalogIds);
    if (state.atlasLanding === "publishers") {
      return publisherFamiliesFor(publisherEcosystems, lensCatalogIds);
    }
    return kindFamiliesFor(lensCatalogIds);
  }, [lensCatalogIds, publisherEcosystems, state.atlasLanding]);
  const lens = ATLAS_LENS_LABELS[state.atlasLanding || "kind"] || ATLAS_LENS_LABELS.kind;
  const lensBlurb = lens.blurb;
  // What the reader is being asked to pick right now. The panel used to say
  // "Pick a framework" on the landing, where every cell is a group of them.
  const lensPrompt = lens.prompt;

  // Landmarks the publisher grouping cannot file. The statutes, regulations
  // and directives are obligations rather than publishers and nobody
  // crosswalks to them; the remainder is anything issued outside the federal
  // ecosystems. Both were named in the view this board replaced, so both stay
  // named here.
  const lensStrips = useMemo(() => {
    if (state.atlasLanding !== "publishers" || !bundle.atlasNetwork) return [];
    const landmarks = new Map(
      (bundle.atlasNetwork.landscape?.nodes || []).map((node) => [node.id, node]),
    );
    const orphaned = publicationsWithoutPublisher(publisherEcosystems, lensCatalogIds);
    const byPublication = new Map(
      (bundle.atlasNetwork.frameworks?.nodes || []).map((node) => [
        node.publicationId,
        node,
      ]),
    );
    return publisherStrips().map((strip) => ({
      id: strip.id,
      heading: strip.heading,
      note: strip.note,
      entries:
        strip.id === "no-publisher"
          ? orphaned.flatMap((catalogId) => {
            const node = byPublication.get(catalogId);
            if (!node) return [];
            return [{
              id: catalogId,
              label: catalogShortNameFor(catalogId, node.label),
              count: Math.max(0, node.canonicalRecordCount - 1),
              publicationId: catalogId,
            }];
          })
          : strip.landmarkIds.flatMap((landmarkId) => {
            const node = landmarks.get(landmarkId);
            if (!node) return [];
            return [{
              id: landmarkId,
              label: node.label,
              count: Math.max(0, node.canonicalRecordCount - 1),
            }];
          }),
    }));
  }, [state.atlasLanding, bundle.atlasNetwork, publisherEcosystems, lensCatalogIds]);

  // One group opened: the same landscape drawing, over the handful of
  // frameworks in that group rather than over all 28. Crosswalks that leave
  // the group are dropped rather than drawn to nothing — the board names those
  // connections, and the group's own page would otherwise show lines running
  // off the edge.
  const inlineFramework = useMemo(() => {
    if (!state.atlasLensFamily || !state.atlasFramework) return null;
    const projection = bundle.atlasNetwork?.publications?.[state.atlasFramework];
    if (!projection) return null;
    const area = areaPresentationForCatalog(state.atlasFramework);
    return {
      projection,
      areaToken: area?.token || "--ca-area-operations",
      label: catalogShortNameFor(state.atlasFramework),
    };
  }, [state.atlasLensFamily, state.atlasFramework, bundle.atlasNetwork]);

  // What the detail column is about: the deepest thing the reader has opened,
  // or whatever they are pointing at in the map. One panel, every altitude.
  const [highlightedId, setHighlightedId] = useState("");

  // The one thing the map is showing right now: groups, then the publications
  // in a group, then the sections in a publication. Same drawing every time —
  // only what it is a picture of changes.
  const areaLevel = useMemo(() => {
    const artifact = bundle.atlasNetwork;
    const empty = {
      depth: 0,
      unit: "Frameworks",
      label: "Groups",
      cells: [] as AtlasAreaNode[],
      trail: [] as { id: string; label: string; current?: boolean; onOpen: () => void }[],
      connectedIds: undefined as Set<string> | undefined,
      selectedId: "",
      onOpen: (_id: string) => {},
    };
    if (!artifact?.frameworks) return empty;

    const byPublication = new Map(
      artifact.frameworks.nodes.map((node) => [node.publicationId, node]),
    );
    const records = (catalogId: string) =>
      Math.max(0, (byPublication.get(catalogId)?.canonicalRecordCount || 1) - 1);
    const tokenFor = (catalogId: string) =>
      areaPresentationForCatalog(catalogId)?.token || "--ca-area-operations";

    const group = lensFamilies.find((entry) => entry.id === state.atlasLensFamily);

    // Depth 2 — inside one publication.
    if (group && state.atlasFramework) {
      const projection = artifact.publications?.[state.atlasFramework];
      const sections = (projection?.nodes || []).filter(
        (node) => node.nodeType !== "catalog",
      );
      return {
        depth: 2,
        // Every family inside one framework holds that framework's own kind of
        // thing, so the whole level shares its word: controls in 800-53, rules
        // in a STIG, techniques in ATT&CK.
        unit: catalogProfileFor(state.atlasFramework).recordLabel,
        label: `Inside ${catalogShortNameFor(state.atlasFramework)}`,
        cells: sections.map((node) => ({
          id: node.id,
          label: node.label,
          value: Math.max(0, node.canonicalRecordCount),
          areaToken: tokenFor(state.atlasFramework),
          openable: Boolean(node.drill),
        })),
        trail: [
          {
            id: group.id,
            label: group.label,
            onOpen: () => patchAtlas({ atlasFramework: "", atlasFamily: "" }),
          },
          {
            id: state.atlasFramework,
            label: catalogShortNameFor(state.atlasFramework),
            current: true,
            onOpen: () => patchAtlas({ atlasFamily: "" }),
          },
        ],
        connectedIds: undefined,
        selectedId: state.atlasFamily,
        onOpen: (id: string) =>
          patchAtlas({ atlasFamily: state.atlasFamily === id ? "" : id }),
      };
    }

    // Depth 1 — the publications in one group. Selecting one lights the ones it
    // actually crosswalks to; the layout claims nothing about which came first.
    if (group) {
      const present = new Set(group.catalogIds);
      const selected = highlightedId || "";
      let connected: Set<string> | undefined;
      if (selected && byPublication.has(selected)) {
        const selectedNodeId = byPublication.get(selected)!.id;
        connected = new Set(
          artifact.frameworks.edges
            .filter(
              (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
            )
            .flatMap((edge) => {
              const otherId = edge.source === selectedNodeId ? edge.target : edge.source;
              const other = artifact.frameworks.nodes.find((n) => n.id === otherId);
              return other && present.has(other.publicationId) ? [other.publicationId] : [];
            }),
        );
      }
      return {
        depth: 1,
        label: group.label,
        // No level-wide unit here: a row of frameworks holds a different kind
        // of thing in every cell, and calling 1,216 controls and 823
        // techniques the same "records" is the flattening that made this map
        // read like a database rather than the field it describes.
        cells: group.catalogIds.map((catalogId) => ({
          id: catalogId,
          label: catalogShortNameFor(catalogId),
          value: records(catalogId),
          areaToken: tokenFor(catalogId),
          openable: true,
          unitLabel: catalogProfileFor(catalogId).recordLabel,
          note: catalogProfileFor(catalogId).publicationKind,
        })),
        trail: [
          {
            id: group.id,
            label: group.label,
            current: true,
            onOpen: () => patchAtlas({ atlasFramework: "", atlasFamily: "" }),
          },
        ],
        connectedIds: connected,
        selectedId: selected,
        onOpen: (catalogId: string) =>
          patchAtlas({ atlasFramework: catalogId, atlasFamily: "" }),
      };
    }

    // Depth 0 — the groups in the chosen lens.
    //
    // Sized by how many frameworks a group holds, not by what is inside them.
    // A STIG rule, an 800-53 control and an ATT&CK technique are not the same
    // unit, so adding them up and comparing the totals as area says only that
    // DISA writes a lot of rules: Implementation took three quarters of the
    // map on 17,375 STIG rules alone and squeezed Risk and outcome frameworks
    // to a sliver too small for its own name. Frameworks are commensurable —
    // a framework is a framework — so that is what the area means here. The
    // contents come back one level down, each in its publisher's own word.
    return {
      depth: 0,
      unit: "Frameworks",
      label: "Groups",
      cells: lensFamilies.map((family) => ({
        id: family.id,
        label: family.label,
        value: family.catalogIds.length,
        areaToken: tokenFor(family.catalogIds[0] || ""),
        openable: family.catalogIds.length > 0,
        note: family.blurb,
        // The frameworks themselves, named on the group that holds them. A
        // reader deciding whether "Control catalogs" is where they should be
        // looking can now see that it means 800-53, 800-53A and 800-171
        // without opening it first.
        members: family.catalogIds.map((catalogId) => catalogShortNameFor(catalogId)),
      })),
      trail: [],
      connectedIds: undefined,
      selectedId: "",
      onOpen: (familyId: string) =>
        patchAtlas({ atlasLensFamily: familyId, atlasFramework: "", atlasFamily: "" }),
    };
  }, [
    bundle.atlasNetwork,
    lensFamilies,
    state.atlasLensFamily,
    state.atlasFramework,
    state.atlasFamily,
    highlightedId,
    patchAtlas,
  ]);

  const pivotSteps = useMemo(
    () => describePivotTrail(state.atlasPivotTrail, bundle.atlasNetwork),
    [state.atlasPivotTrail, bundle.atlasNetwork],
  );
  // Short names throughout the route bar: it is a compact record of a
  // journey, and the full publication title already heads the page.
  const currentFrameworkLabel = state.atlasFramework
    ? catalogShortNameFor(
        state.atlasFramework,
        bundle.atlasNetwork?.publications?.[state.atlasFramework]?.label || "",
      )
    : "Cybersecurity";
  const [record, setRecord] = useState<AtlasNeighborhoodRecord | null>(null);
  const [recordStatus, setRecordStatus] = useState<
    "idle" | "loading" | "ready" | "missing" | "error"
  >(nodeId ? "loading" : "idle");
  const [benchmarkRecord, setBenchmarkRecord] =
    useState<AtlasNeighborhoodRecord | null>(null);
  const [benchmarkStatus, setBenchmarkStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >(state.atlasBenchmark ? "loading" : "idle");
  // Anything that gives the page a subject of its own: a focused record, or a
  // framework the reader has opened. Either way the landscape-wide hero copy
  // is no longer describing what they are looking at.
  const hasSubject = Boolean(nodeId) || Boolean(state.atlasFramework);
  const [mapSearchDraft, setMapSearchDraft] = useState(
    state.relationshipSearch || "",
  );
  const [searchAnnouncement, setSearchAnnouncement] = useState("");
  const [noMatchQuery, setNoMatchQuery] = useState("");

  useEffect(() => {
    setMapSearchDraft(state.relationshipSearch || "");
  }, [state.relationshipSearch]);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    if (!nodeId) {
      setRecordStatus("idle");
      return () => {
        cancelled = true;
      };
    }
    setRecordStatus("loading");
    loadAtlasNeighborhood(nodeId)
      .then((nextRecord) => {
        if (cancelled) return;
        startTransition(() => {
          setRecord(nextRecord ? selectAtlasStructuralPath(nextRecord, state.atlasParent) : null);
          setRecordStatus(nextRecord ? "ready" : "missing");
        });
      })
      .catch(() => {
        if (!cancelled) setRecordStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, state.atlasParent]);

  useEffect(() => {
    let cancelled = false;
    setBenchmarkRecord(null);
    if (!state.atlasBenchmark) {
      setBenchmarkStatus("idle");
      return () => {
        cancelled = true;
      };
    }
    setBenchmarkStatus("loading");
    loadAtlasNeighborhood(state.atlasBenchmark)
      .then((nextRecord) => {
        if (cancelled) return;
        startTransition(() => {
          setBenchmarkRecord(nextRecord);
          setBenchmarkStatus(nextRecord ? "ready" : "error");
        });
      })
      .catch(() => {
        if (!cancelled) setBenchmarkStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [state.atlasBenchmark]);

  useEffect(() => {
    if (!record) return;
    const progressiveTitle = document.querySelector<HTMLElement>(
      "[data-static-route-title]",
    );
    if (progressiveTitle) {
      progressiveTitle.textContent = focusedAtlasTitle(bundle, record);
    }
  }, [bundle, record]);

  function patchAtlas(patch: Partial<typeof state>) {
    onNavigate("atlas-map", patch);
  }

  const drillAtlas = useCallback((drill: AtlasProjectionDrill) => {
    if (drill.kind === "ecosystem") {
      patchAtlas({
        node: "",
        atlasAxis: "",
        atlasLimb: drill.targetId,
        atlasFramework: "",
        atlasFamily: "",
        relationshipView: "",
      });
      return;
    }
    if (drill.kind === "area") {
      patchAtlas({
        node: "",
        atlasAxis: "",
        atlasLimb: drill.targetId,
        atlasFramework: "",
        atlasFamily: "",
        relationshipView: "",
      });
      return;
    }
    if (drill.kind === "publication") {
      const location = bundle.atlasNetwork?.record_locations[`${drill.targetId}:CATALOG`];
      const areaId = location?.ecosystemId || location?.areaId || state.atlasLimb;
      patchAtlas({
        node: "",
        atlasLimb: areaId,
        atlasFramework: drill.targetId,
        atlasFamily: "",
        relationshipView: "",
      });
      return;
    }
    if (drill.kind === "detail") {
      patchAtlas({ atlasFamily: drill.targetId, relationshipView: "" });
      return;
    }
    patchAtlas({ node: drill.targetId, atlasParent: "", relationshipSearch: "", relationshipView: "" });
  }, [bundle.atlasNetwork, onNavigate, state.atlasLimb]);

  /**
   * Opens a record in the framework it actually belongs to.
   *
   * Opening a connected record used to change only the node, leaving the
   * scope pointing at the framework the reader came from — so following a
   * crosswalk from 800-53 into CSF left the page claiming to be inside
   * 800-53, with CSF's own structure unreachable. A crosswalk is a move
   * between frameworks, so taking one moves the scope too, and the crossing
   * is recorded on the trail because the framework left behind is not an
   * ancestor of the one arrived at and nothing else would remember it.
   */
  const openRecordInContext = useCallback((targetNodeId: string) => {
    const location = bundle.atlasNetwork?.record_locations[targetNodeId];
    const shared = {
      node: targetNodeId,
      atlasParent: "",
      atlasStage: "",
      relationshipGroup: "",
      relationshipSearch: "",
    };
    if (!location || !location.publicationId) {
      patchAtlas(shared);
      return;
    }
    const crossesFramework =
      Boolean(state.atlasFramework) && location.publicationId !== state.atlasFramework;
    patchAtlas({
      ...shared,
      atlasLimb: location.ecosystemId || location.areaId || state.atlasLimb,
      atlasFramework: location.publicationId,
      atlasFamily: location.detailId || "",
      atlasPivotTrail: crossesFramework
        ? pushPivot(state.atlasPivotTrail, {
            ecosystemId: state.atlasLimb,
            publicationId: state.atlasFramework,
            nodeId: state.node,
          })
        : state.atlasPivotTrail,
    });
  }, [
    bundle.atlasNetwork,
    onNavigate,
    state.atlasFramework,
    state.atlasLimb,
    state.atlasPivotTrail,
    state.node,
  ]);

  /** Steps back to a framework the reader crossed from earlier. */
  const returnToPivot = useCallback((index: number) => {
    const steps = parsePivotTrail(state.atlasPivotTrail);
    const step = steps[index];
    if (!step) return;
    patchAtlas({
      node: step.nodeId,
      atlasParent: "",
      atlasLimb: step.ecosystemId,
      atlasFramework: step.publicationId,
      atlasFamily: "",
      atlasStage: "",
      relationshipGroup: "",
      relationshipSearch: "",
      atlasPivotTrail: truncatePivotTrail(state.atlasPivotTrail, index),
    });
  }, [onNavigate, state.atlasPivotTrail]);

  /**
   * Back to the unscoped Atlas. `landing` is preserved by default so the
   * breadcrumb's root returns the reader to the survey they were actually
   * using; only the explicit "All groups" control switches survey.
   */
  function atlasHome(landing: string = state.atlasLanding) {
    patchAtlas({
      node: "",
      atlasAxis: "",
      atlasLimb: "",
      atlasFramework: "",
      atlasFamily: "",
      atlasLensFamily: "",
      atlasPivotTrail: "",
      atlasLanding: landing,
      relationshipView: "",
    });
  }

  // What the detail column is about: the deepest thing the reader has opened,
  // or whatever they are pointing at in the map. One panel, every altitude.
  const panelSubject = useMemo<AtlasPanelSubject | null>(() => {
    const artifact = bundle.atlasNetwork;
    if (!artifact?.frameworks) return null;
    const byPublication = new Map(
      artifact.frameworks.nodes.map((node) => [node.publicationId, node]),
    );
    const records = (catalogId: string) =>
      Math.max(0, (byPublication.get(catalogId)?.canonicalRecordCount || 1) - 1);

    const describeFramework = (catalogId: string): AtlasPanelSubject | null => {
      const node = byPublication.get(catalogId);
      if (!node) return null;
      const profile = catalogProfileFor(catalogId);
      const area = areaPresentationForCatalog(catalogId);
      const crosswalks = artifact.frameworks.edges
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .sort((a, b) => b.relationshipCount - a.relationshipCount)
        .flatMap((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          const other = artifact.frameworks.nodes.find((n) => n.id === otherId);
          if (!other) return [];
          return [{
            id: edge.id,
            label: catalogShortNameFor(other.publicationId, other.label),
            count: edge.relationshipCount,
            areaToken:
              areaPresentationForCatalog(other.publicationId)?.token
              || "--ca-area-operations",
            onOpen: () =>
              patchAtlas({ atlasFramework: other.publicationId, atlasFamily: "" }),
          }];
        });
      const builtOn = frameworkDependencyParent(catalogId);
      const buildOn = artifact.frameworks.nodes
        .map((other) => other.publicationId)
        .filter((other) => frameworkDependencyParent(other) === catalogId)
        .sort();
      return {
        eyebrow: node.publicationKind || profile.publicationKind,
        title: catalogDisplayNameFor(catalogId) || node.label,
        blurb: profile.synopsis || node.description || "",
        areaToken: area?.token || "--ca-area-operations",
        facts: [
          { label: profile.recordLabel, value: formatPanelCount(records(catalogId)) },
          { label: "Area", value: area?.label || "—" },
        ],
        sections: [
          // Dependency is a claim, so it is a sentence you can read and argue
          // with rather than the shape of the drawing. data/curated's spine is
          // hand-written because the crosswalk data cannot supply direction.
          ...(builtOn || buildOn.length
            ? [{
              heading: "Where it sits",
              note: [
                builtOn ? `Builds on ${catalogShortNameFor(builtOn)}.` : "",
                buildOn.length
                  ? `${buildOn.map((id) => catalogShortNameFor(id)).join(", ")} ${buildOn.length === 1 ? "builds" : "build"} on it.`
                  : "",
              ].filter(Boolean).join(" "),
              links: [],
            }]
            : []),
          crosswalks.length
            ? { heading: "Crosswalks to", links: crosswalks }
            : {
              heading: "Crosswalks",
              note: "No published mapping to another framework yet. Its records are still fully browsable.",
              links: [],
            },
        ],
        action: {
          label: `Open ${catalogShortNameFor(catalogId)}`,
          onOpen: () => drillAtlas({ kind: "publication", targetId: catalogId }),
        },
      };
    };

    // Deepest first: a section inside a framework, then the framework, then
    // whatever is merely being pointed at, then the open group.
    if (state.atlasFamily && inlineFramework) {
      const section = inlineFramework.projection.nodes.find(
        (node) => node.id === state.atlasFamily,
      );
      if (section) {
        // The end of the drawing and the point of the whole thing: the records
        // themselves. Area says nothing here — every control holds exactly one
        // record — so they are a list, and each one opens.
        const detail = section.drill?.kind === "detail"
          ? bundle.atlasNetwork?.details?.[section.drill.targetId]
          : undefined;
        const records = (detail?.nodes || [])
          .filter((node) => node.nodeType !== "catalog")
          .map((node) => ({
            id: node.id,
            label: node.label,
            // These are the leaves: every one holds exactly itself. A column
            // of 148 identical "1"s down the panel is noise, so a count of one
            // is not worth printing.
            count: node.canonicalRecordCount > 1 ? node.canonicalRecordCount : 0,
            areaToken: inlineFramework.areaToken,
            onOpen: node.drill ? () => drillAtlas(node.drill!) : undefined,
          }));
        const noun = catalogProfileFor(state.atlasFramework).recordLabel;
        // The projection generates "N publisher-native records." for groups
        // that have no publisher description of their own. Beside a fact and a
        // list heading both carrying the same number, that is the third
        // restatement of one count — and in the wrong vocabulary. Real
        // publisher descriptions still show.
        const described = /publisher-native records\.$/.test(section.description || "")
          ? ""
          : section.description || "";
        return {
          eyebrow: `Inside ${inlineFramework.label}`,
          title: section.label,
          blurb: described,
          areaToken: inlineFramework.areaToken,
          // No fact row: the list heading below already states the count, and
          // stacking "CONTROLS 148" above "148 controls" says one number
          // twice.
          facts: records.length
            ? []
            : [{ label: noun, value: formatPanelCount(section.canonicalRecordCount) }],
          sections: records.length
            ? [{ heading: withUnitNoun(records.length, noun), links: records }]
            : [],
          action: section.drill && !records.length
            ? { label: `Open ${section.label}`, onOpen: () => drillAtlas(section.drill!) }
            : undefined,
        };
      }
    }
    if (state.atlasFramework) return describeFramework(state.atlasFramework);

    const describeGroup = (group: (typeof lensFamilies)[number]) => ({
        eyebrow: "Group",
        title: group.label,
        blurb: group.rationale || group.blurb,
        areaToken:
          areaPresentationForCatalog(group.catalogIds[0] || "")?.token
          || "--ca-area-operations",
        // One fact, not two. The second used to add every framework's records
        // together, which is the sum the map itself refuses to draw: a STIG
        // rule, an 800-53 control and an ATT&CK technique are not the same
        // unit, so their total is a number with no meaning.
        facts: [{ label: "Frameworks", value: String(group.catalogIds.length) }],
        sections: [{
          heading: "What is in it",
          links: group.catalogIds.map((catalogId) => ({
            id: catalogId,
            label: catalogShortNameFor(catalogId),
            count: records(catalogId),
            areaToken:
              areaPresentationForCatalog(catalogId)?.token || "--ca-area-operations",
            onOpen: () => patchAtlas({ atlasFramework: catalogId, atlasFamily: "" }),
          })),
        }],
    });

    // The panel promises "Point at a group to see what is in it", and on the
    // landing that promise had no implementation: highlightedId was only ever
    // resolved as a framework, so hovering a group left the rail at rest. It
    // can be either depending on depth, so resolve a group first.
    const highlightedGroup = highlightedId
      ? lensFamilies.find((entry) => entry.id === highlightedId)
      : undefined;
    if (highlightedGroup) return describeGroup(highlightedGroup);
    if (highlightedId) return describeFramework(highlightedId);

    const group = lensFamilies.find((entry) => entry.id === state.atlasLensFamily);
    if (group) return describeGroup(group);
    return null;
  }, [
    bundle.atlasNetwork,
    state.atlasFamily,
    state.atlasFramework,
    state.atlasLensFamily,
    highlightedId,
    inlineFramework,
    lensFamilies,
    patchAtlas,
    drillAtlas,
  ]);

  const trailAtlas = useCallback((level: "root" | "ecosystem" | "area" | "publication" | "detail", id: string) => {
    if (level === "root") {
      // The breadcrumb's root is the top of the survey the reader walked down
      // from, so it returns them to that survey rather than switching them to
      // the other one.
      atlasHome("publishers");
      return;
    }
    if (level === "ecosystem" || level === "area") {
      patchAtlas({ node: "", atlasFramework: "", atlasFamily: "", atlasLimb: id, relationshipView: "" });
      return;
    }
    if (level === "publication") {
      patchAtlas({ node: "", atlasFamily: "", atlasFramework: id, relationshipView: "" });
      return;
    }
    patchAtlas({ node: "", atlasFamily: id, relationshipView: "" });
  }, [onNavigate]);

  function atlasUp() {
    if (state.atlasFamily) {
      patchAtlas({ atlasFamily: "", relationshipView: "" });
      return;
    }
    if (state.atlasFramework) {
      patchAtlas({ atlasFramework: "", relationshipView: "" });
      return;
    }
    if (state.atlasLimb) {
      patchAtlas({ atlasLimb: "", relationshipView: "" });
      return;
    }
    // One step up from inside a group is the board of groups, not the top of
    // the route — the lens is still the reader's choice.
    if (state.atlasLensFamily) {
      patchAtlas({ atlasLensFamily: "", relationshipView: "" });
      return;
    }
    atlasHome();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bundle.librarySearchReady) return;
    const query = mapSearchDraft.trim();
    if (!query) return;
    const exactSemanticRecord = Object.entries(bundle.atlasNetwork?.record_locations || {})
      .find(([nodeId]) => nodeId.toLocaleLowerCase() === query.toLocaleLowerCase());
    if (exactSemanticRecord) {
      const [nodeId, location] = exactSemanticRecord;
      setNoMatchQuery("");
      setSearchAnnouncement(`Opened ${location.label} in its publisher context.`);
      patchAtlas({
        node: nodeId,
        atlasParent: "",
        atlasLimb: location.ecosystemId || location.areaId,
        atlasFramework: location.publicationId,
        atlasFamily: location.detailId || "",
        relationshipSearch: "",
        relationshipGroup: "",
        atlasStage: "",
        relationshipView: "",
      });
      return;
    }
    const transition = resolveAtlasSearchTransition(bundle.runtime, query);
    setSearchAnnouncement(transition.announcement);
    if (transition.kind === "search") {
      onNavigate("search", { query: transition.query });
      return;
    }
    if (transition.kind === "no-match") {
      setNoMatchQuery(transition.query);
      return;
    }
    setNoMatchQuery("");
    const location = bundle.atlasNetwork?.record_locations[transition.nodeId];
    patchAtlas({
      node: transition.nodeId,
      atlasParent: "",
      atlasLimb: location?.ecosystemId || location?.areaId || "",
      atlasFramework: location?.publicationId || "",
      atlasFamily: location?.detailId || "",
      relationshipSearch: "",
      relationshipGroup: "",
      atlasStage: "",
      relationshipView: "",
    });
  }

  return (
    <section
      className="atlas-workspace"
      data-page-template="canvas"
      data-visual-identity="technical-cartography"
      data-route-content-ready={
        recordStatus === "loading" ? "false" : "true"
      }
    >
      {/* The landing copy is a claim about the whole landscape, which stops
          being true the moment a record is in focus — and its 148px of hero
          was pushing that record's connection graph off the fold. With a
          subject, the header shrinks to the route name and the search box;
          the focused card below states everything this paragraph would.
          Scoping into a framework is the same situation: "open a publisher to
          follow its publications" is not what the reader is doing once they
          have opened one, and leaving it there put ~469px of chrome between
          the click and the thing it opened. */}
      <header
        className="atlas-canvas-header"
        data-atlas-header={hasSubject ? "focused" : "landing"}
        data-route-primary-header="true"
      >
        <div data-route-primary-copy="true">
          {hasSubject ? null : (
            <p className="eyebrow">{FIRST_PAINT_ROUTE_COPY.atlas.eyebrow}</p>
          )}
          <h1 id="atlas-page-title">Atlas</h1>
          {hasSubject ? null : <p>{SITE_COPY.routes.atlas.purpose}</p>}
        </div>
        <form className="atlas-map-command" onSubmit={submitSearch}>
          <label className="visually-hidden" htmlFor="atlas-search">
            Jump to a record
          </label>
          <div className="search-input">
            <IconSearch aria-hidden="true" size={20} stroke={1.8} />
            <input
              aria-label="Jump to a record"
              disabled={!bundle.librarySearchReady}
              id="atlas-search"
              name="query"
              onChange={(event) => setMapSearchDraft(event.target.value)}
              placeholder="Jump to a record"
              type="search"
              value={mapSearchDraft}
            />
          </div>
          {/* Kept so the form has a submit control (implicit Enter submission),
              but out of the tab order: an invisible tab stop strands sighted
              keyboard users on a control they cannot see. */}
          <button className="visually-hidden" disabled={!bundle.librarySearchReady} tabIndex={-1} type="submit">Search</button>
        </form>
      </header>
      <span
        aria-atomic="true"
        className="visually-hidden"
        role="status"
      >
        {searchAnnouncement}
      </span>
      {noMatchQuery ? (
        <div className="atlas-search-recovery">
          <p>
            No record matches <strong>{noMatchQuery}</strong>.
          </p>
          <div className="card-actions">
            <AppLink onNavigate={onNavigate} patch={{ query: noMatchQuery }} variant="secondary" view="search">
              Search all records
            </AppLink>
            <AppLink onNavigate={onNavigate} variant="secondary" view="search">
              Browse the Library
            </AppLink>
          </div>
        </div>
      ) : null}

      <AtlasLensBar
        activePublicationId={state.atlasFramework}
        onPick={(entry) =>
          patchAtlas({
            node: "",
            atlasAxis: "",
            atlasLimb: entry.ecosystemId,
            atlasFramework: entry.publicationId,
            atlasFamily: "",
            atlasPivotTrail: "",
            relationshipView: "",
          })
        }
        landing={state.atlasLanding}
        // Switching lens re-asks the question from the top: the group you had
        // open belongs to the lens you just left.
        onLandingChange={(atlasLanding) =>
          patchAtlas({ atlasLanding, atlasLensFamily: "" })
        }
        onWholeLandscape={() => atlasHome(state.atlasLanding)}
        scoped={Boolean(
          state.atlasLimb
            || state.atlasFramework
            || state.atlasFamily
            || state.atlasLensFamily
            || nodeId,
        )}
      />

      {/* Three steps, each showing a readable number of things: the groups in
          the chosen lens, then the frameworks inside one group and how they
          depend on each other, then the structure inside one framework.

          The landing used to open on all 28 frameworks at once, which is more
          than anyone can take in and which put SP 800-53 at the top of
          everything — see viewState's atlasLanding for why that was a claim we
          could not support. */}
      {bundle.atlasNetwork && atlasProjection && !hierarchyRequested && !nodeId ? (
        // A group open on the board owns everything below it: the framework
        // and section the reader opened there are drawn in place, so a scope
        // being set is not on its own a reason to leave for the columns.
        (!state.atlasLensFamily
          && (atlasScope.areaId || atlasScope.publicationId || atlasScope.detailId))
        // An artifact built before the frameworks projection existed still
        // has to render something, so a cached bundle degrades to the columns
        // rather than to an empty page.
        || !bundle.atlasNetwork.frameworks?.nodes?.length ? (
          // Inside a framework the columns answer "what is in this?" — the
          // links panel keeps "what does it relate to?" on screen beside them,
          // which is what the reader came in holding.
          <div
            className="atlas-scoped"
            data-has-links={state.atlasFramework ? "true" : undefined}
          >
            <AtlasDecompositionMap
              artifact={bundle.atlasNetwork}
              onDrill={drillAtlas}
              onNavigate={onNavigate}
              onTrail={trailAtlas}
              scope={atlasScope}
            />
            {state.atlasFramework && bundle.atlasNetwork.frameworks?.nodes?.length ? (
              <AtlasFrameworkLinks
                frameworks={bundle.atlasNetwork.frameworks}
                onOpen={(targetPublicationId) =>
                  drillAtlas({ kind: "publication", targetId: targetPublicationId })
                }
                publicationId={state.atlasFramework}
                sharedGround={bundle.atlasNetwork.framework_shared_ground || []}
              />
            ) : null}
          </div>
        ) : (
          <div className="atlas-workbench">
            {/* Where you are, and the way back up. The map itself never
                changes screens, so this is the only thing that has to say
                how deep you went. It is a row of the workbench rather than the
                first thing inside the map column, so the map surface and the
                detail panel start their borders on the same line. */}
            <nav aria-label="Map depth" className="atlas-mapcol__trail">
                <button
                  aria-current={areaLevel.depth === 0 ? "true" : undefined}
                  onClick={() =>
                    patchAtlas({ atlasLensFamily: "", atlasFramework: "", atlasFamily: "" })
                  }
                  type="button"
                >
                  All groups
                </button>
                {areaLevel.trail.map((step) => (
                  <Fragment key={step.id}>
                    <span aria-hidden="true">/</span>
                    <button
                      aria-current={step.current ? "true" : undefined}
                      onClick={step.onOpen}
                      type="button"
                    >
                      {step.label}
                    </button>
                  </Fragment>
                ))}
            </nav>

            <div className="atlas-mapcol">
              <AtlasAreaMap
                connectedIds={areaLevel.connectedIds}
                label={areaLevel.label}
                nodes={areaLevel.cells}
                unit={areaLevel.unit}
                onHighlight={setHighlightedId}
                onOpen={areaLevel.onOpen}
                selectedId={areaLevel.selectedId}
                tall
              />

              {lensStrips
                .filter((strip) => strip.entries.length > 0)
                .map((strip) => (
                  <p className="atlas-mapcol__aside" key={strip.id}>
                    <span>{strip.heading}</span>
                    {strip.entries.map((entry) => (
                      <em key={entry.id}>
                        {entry.label} {entry.count.toLocaleString("en-US")}
                      </em>
                    ))}
                  </p>
                ))}
            </div>

            {/* One panel beside one map. Every altitude reports into it, and
                nothing in it navigates away from the picture. */}
            <AtlasDetailPanel
              restingBlurb={`${lensBlurb}. Point at a group to see what is in it; click to open its frameworks, then a framework to see what it holds.`}
              restingFacts={[
                { label: "Frameworks", value: String(lensCatalogIds.length) },
                {
                  label: "Crosswalk pairings",
                  value: String(bundle.atlasNetwork.frameworks?.edges?.length || 0),
                },
              ]}
              restingTitle={lensPrompt}
              subject={panelSubject}
            />
          </div>
        )
      ) : !bundle.atlasNetwork ? (
        <p className="atlas-load-inline-error" role="alert">The global Atlas network is unavailable. Reload the page to try again.</p>
      ) : null}

      {/* No view switcher before a record exists: Map and List are views OF a
          chosen record. Offering them with nothing selected produced a
          dead-end that told the user to go choose a record. With no subject,
          this route's only job is helping them pick one. */}

      <AtlasPivotTrailBar
        currentLabel={currentFrameworkLabel}
        onClear={() => patchAtlas({ atlasPivotTrail: "" })}
        onReturn={returnToPivot}
        steps={pivotSteps}
      />

      <div className="atlas-view-panel" id="atlas-view-panel">
      {recordStatus === "loading" ? (
        <div className="atlas-loading" role="status">
          <div aria-hidden="true" className="atlas-loading-block" />
          Loading this record's connections…
        </div>
      ) : null}

      {recordStatus === "missing" || recordStatus === "error" ? (
        <AtlasLoadFailure
          error={recordStatus === "error"}
          onNavigate={onNavigate}
          query={state.node}
        />
      ) : null}

      {record ? (
        <FocusedAtlas
          bundle={bundle}
          compact={compact}
          onNavigate={onNavigate}
          onOpenNode={onOpenNode}
          onOpenRecordInContext={openRecordInContext}
          patchAtlas={patchAtlas}
          record={record}
          state={state}
          view={view}
        />
      ) : recordStatus === "idle" && bundle.routeReady && hierarchyRequested ? (
        <AtlasGuidedPath
          bundle={bundle}
          benchmarkRecord={benchmarkRecord}
          onNavigate={onNavigate}
          onOpenNode={onOpenNode}
          patchAtlas={patchAtlas}
          state={state}
        />
      ) : recordStatus === "idle" && !bundle.routeReady ? (
        <div className="atlas-loading" role="status">
          <div aria-hidden="true" className="atlas-loading-block" />
          Preparing the Atlas…
        </div>
      ) : null}
      {benchmarkStatus === "error" ? (
        <p className="atlas-load-inline-error" role="alert">
          This benchmark could not be loaded. Choose another technology or return to the Atlas overview.
        </p>
      ) : null}
      </div>
    </section>
  );
}

function FocusedAtlas(props: {
  bundle: RuntimeBundle;
  compact: boolean;
  record: AtlasNeighborhoodRecord;
  state: AtlasMapPageProps["state"];
  view: AtlasView;
  patchAtlas: (patch: Partial<AtlasMapPageProps["state"]>) => void;
  onNavigate: AtlasMapPageProps["onNavigate"];
  onOpenNode: AtlasMapPageProps["onOpenNode"];
  /** Opens a record in its own framework, recording a crosswalk crossing. */
  onOpenRecordInContext: (nodeId: string) => void;
}) {
  const {
    bundle,
    compact,
    record,
    state,
    view,
    patchAtlas,
    onNavigate,
    onOpenNode,
    onOpenRecordInContext,
  } = props;
  const filters: AtlasFilterState = {
    relationshipType: state.relationshipType,
    provenance: state.provenance,
    confidence: state.confidence,
    nodeType: state.nodeType,
    includeCandidates: state.includeCandidates === "true",
    search: state.relationshipSearch,
  };
  const groups = useMemo(
    () => buildAtlasContextGroups(record, filters),
    [record, state],
  );
  const connectionKeys = useMemo(
    () => new Set(
      groups.flatMap((group) =>
        group.items.map((item) => `${item.edge.id}\u0000${item.counterpart.id}`),
      ),
    ),
    [groups],
  );
  const rows = useMemo(
    () => buildAtlasContextRows(record, filters).filter((row) =>
      connectionKeys.has(`${row.edge.id}\u0000${row.counterpart.id}`),
    ),
    [record, state, connectionKeys],
  );
  // List must never disagree with Map about what class a record belongs to
  // (a CCI reads "Correlation" in both, never "Implementation" in one and
  // "Correlation" in the other) — derive the label from the same groups.
  const lensLabelByEdgeId = useMemo(() => {
    const labelByLens = new Map(
      ATLAS_RELATIONSHIP_LENSES.map((lens) => [lens.id, lens.label] as const),
    );
    const map = new Map<string, string>();
    for (const group of groups) {
      const label = labelByLens.get(group.lens);
      if (!label) continue;
      for (const item of group.items) map.set(item.edge.id, label);
    }
    return map;
  }, [groups]);
  const listRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        lensLabel: lensLabelByEdgeId.get(row.edge.id),
      })),
    [rows, lensLabelByEdgeId],
  );
  const relationshipScopes = useMemo(
    () => summarizeAtlasRelationshipScopes(record),
    [record],
  );
  const options = useMemo(
    () => atlasFilterOptions(record, { excludeStructural: true }),
    [record],
  );
  const structuralChildren = useMemo(
    () => buildStructuralChildren(record),
    [record],
  );
  const neighborhoodNodeById = useMemo(
    () => new Map(record.nodes.map((node) => [node.id, node] as const)),
    [record.nodes],
  );
  const identityForNode = (nodeId: string) =>
    runtimeRecordIdentityFor(bundle, nodeId, neighborhoodNodeById.get(nodeId));
  const [selectedRow, setSelectedRow] = useState<AtlasRelationshipRow | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const previousRecordIdRef = useRef(record.center_node.id);
  const centerLabel =
    record.center_node.metadata?.item_id ||
    record.center_node.metadata?.title ||
    record.center_node.label;
  const centerIdentity = identityForNode(record.center_node.id);
  const centerStableIdIsGenerated = centerIdentity.stableIdIsGenerated;
  // Publication name, never the raw catalog id: `NIST-800-53` is a slug, and
  // the eyebrow printed it verbatim until the catalog lookup was added.
  const centerCatalogId = record.center_node.metadata?.catalog_id || "";
  const centerCatalog = bundle.runtime
    .getCatalogs()
    .find((catalog: any) => catalog.id === centerCatalogId);
  const centerPublication = catalogDisplayNameFor(
    centerCatalogId,
    centerCatalog?.name ||
      bundle.runtime.getSource(record.center_node.source_id)?.display_name ||
      bundle.runtime.getSource(record.center_node.source_id)?.name ||
      "",
  );
  const centerTitle =
    record.center_node.metadata?.title || record.center_node.label || centerLabel;

  // What the record actually says. The Atlas used to show a title, a
  // publication, and a connection count — never the published statement —
  // so drilling four columns deep landed on less than the search box already
  // returns. The text and the routes out are both read from the same runtime
  // the record page uses, so the two surfaces cannot drift.
  const centerDocument = bundle.runtime.getLibraryDocument(record.center_node.id);
  const centerSource = bundle.runtime.getSource(
    centerDocument?.source_id || record.center_node.source_id,
  );
  const centerOfficialSource = officialSourceFor(centerSource);
  const centerClaimOrigin =
    (record.center_node.metadata as { origin?: string } | undefined)?.origin ||
    "publisher_normalized";
  const centerMetadata = {
    ...record.center_node.metadata,
    description:
      centerDocument?.description || record.center_node.metadata?.description || "",
  };
  const centerType = record.center_node.node_type || centerDocument?.object_type || "";
  const centerPresentation = SUPPORTED_RECORD_TYPES.includes(centerType)
    ? recordPresentationContract(centerCatalogId, centerType)
    : null;
  const centerPublishedSections = centerPresentation
    ? publishedSectionsWithContent(centerPresentation.sections, centerMetadata)
    : [];
  const inspectedId = selectedRow?.counterpart.id || record.center_node.id;
  const inspectedNode = bundle.runtime.getNode(inspectedId);
  const inspectedDocument = bundle.runtime.getLibraryDocument(inspectedId);
  const inspectedItemId =
    inspectedDocument?.item_id ||
    inspectedNode?.metadata?.item_id ||
    selectedRow?.itemId ||
    centerLabel;
  const inspectedTitle =
    inspectedDocument?.title ||
    inspectedNode?.metadata?.title ||
    selectedRow?.title ||
    centerTitle;
  const showInspectedTitle =
    inspectedTitle.trim().toLocaleLowerCase() !==
    inspectedItemId.trim().toLocaleLowerCase();
  const inspectedSynopsis =
    inspectedDocument?.description || inspectedNode?.metadata?.description || "";
  const inspectedIdentity = identityForNode(inspectedId);
  const inspectedOfficialName = inspectedIdentity.secondary;
  const inspectedType = inspectedDocument?.object_type || inspectedNode?.node_type || "";
  const inspectedPresentation = SUPPORTED_RECORD_TYPES.includes(inspectedType)
    ? recordPresentationContract(
        inspectedDocument?.catalog_id || inspectedNode?.metadata?.catalog_id || "",
        inspectedType,
      )
    : null;
  const selectedSource = selectedRow?.edge.source_refs?.[0];
  const choiceLabels = [
    state.atlasFramework
      ? bundle.runtime.getNode(`${state.atlasFramework}:CATALOG`)?.metadata
          ?.title ||
        bundle.runtime.getNode(`${state.atlasFramework}:CATALOG`)?.label ||
        ""
      : "",
    state.atlasBaseline
      ? state.atlasBaseline === "all"
        ? "All records"
        : bundle.runtime.getNode(state.atlasBaseline)?.metadata?.title ||
          bundle.runtime.getNode(state.atlasBaseline)?.label ||
          ""
      : "",
    state.atlasFamily
      ? bundle.runtime.getNode(state.atlasFamily)?.metadata?.title ||
        bundle.runtime.getNode(state.atlasFamily)?.label ||
        ""
      : "",
  ].filter(Boolean);
  const selectedGroup = selectedRow
    ? groups.find((group) =>
        group.items.some(
          (item) =>
            item.edge.id === selectedRow.edge.id &&
            item.counterpart.id === selectedRow.counterpart.id,
        ),
      )
    : null;

  useEffect(() => {
    if (!selectedRow) return;
    const frame = window.requestAnimationFrame(() => {
      if (inspectorRef.current) {
        scrollElementBelowHeader(inspectorRef.current, "auto");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedRow]);

  // A click in the Atlas must expose its next task. Previously a record
  // change left Connections below the fold with no indication that it had
  // rendered. Do not disturb an initial deep link, but move a subsequent
  // Atlas selection to the now-ready workspace and announce it by focus.
  useEffect(() => {
    if (previousRecordIdRef.current === record.center_node.id) return;
    previousRecordIdRef.current = record.center_node.id;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.getElementById("atlas-connections-heading");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [record.center_node.id]);

  function updateFilters(patch: Partial<AtlasFilterState>) {
    setSelectedRow(null);
    patchAtlas({
      relationshipType:
        patch.relationshipType === undefined
          ? state.relationshipType
          : patch.relationshipType,
      provenance:
        patch.provenance === undefined ? state.provenance : patch.provenance,
      confidence:
        patch.confidence === undefined ? state.confidence : patch.confidence,
      nodeType: patch.nodeType === undefined ? state.nodeType : patch.nodeType,
      includeCandidates:
        patch.includeCandidates === undefined
          ? state.includeCandidates
          : patch.includeCandidates
            ? "true"
            : "",
      relationshipSearch:
        patch.search === undefined ? state.relationshipSearch : patch.search,
      relationshipGroup: "",
    });
  }

  // The record workspace always shows Connections. relationshipView now
  // selects which supporting panel is open, so old deep links still resolve.
  const hierarchyOpen = view === "path";
  const listOpen = view === "list";

  // One definition, rendered in exactly one place: it is the Path view's own
  // content, and on Map and List it sits in the header so the record's
  // position never leaves the screen. Rendering both duplicated the landmark.
  const structuralPosition = (
    <section className="atlas-structural-position">
      {/* Not "Control Atlas structure" — WhereThisSitsRail badges only the
          organizing hops it actually derived; the rest of this path
          (catalog family onward) is the publisher's own declared hierarchy,
          and a blanket eyebrow claiming the whole path is Control Atlas's
          own would contradict that per-crumb distinction. */}
      <h2 className="atlas-path-heading">Where this sits</h2>
      <WhereThisSitsRail
        bundle={bundle}
        links={
          record.structural_path.length > 1 ||
          record.center_node.node_type === "catalog"
            ? record.structural_path
            : undefined
        }
        nodeId={record.center_node.id}
        onOpenNode={(node) =>
          patchAtlas({ node, atlasStage: "", relationshipGroup: "" })
        }
      />
      {choiceLabels.length ? (
        <nav aria-label="Current selection" className="atlas-choice-trail">
          <strong>Current selection</strong>
          <span>{choiceLabels.join(" > ")}</span>
        </nav>
      ) : null}
    </section>
  );

  const noConnections = (
    <AtlasNoConnections
      candidateCount={record.candidate_connection_count}
      filtersActive={Boolean(
        filters.relationshipType ||
          filters.provenance ||
          filters.confidence ||
          filters.nodeType ||
          filters.search,
      )}
      includeCandidates={filters.includeCandidates}
      onClear={() =>
        updateFilters({
          relationshipType: "",
          provenance: "",
          confidence: "",
          nodeType: "",
          search: "",
        })
      }
      onIncludeCandidates={() =>
        updateFilters({ includeCandidates: true })
      }
      onNavigate={onNavigate}
      query={centerLabel}
    />
  );

  return (
    <div className="atlas-focused-shell">
      <section aria-labelledby="atlas-focused-record-heading" className="atlas-focused-context">
        <div>
          <p className="eyebrow">Focused record</p>
          <h2 id="atlas-focused-record-heading"><AcronymText>{centerIdentity.primary}</AcronymText></h2>
          {centerIdentity.secondary ? <p><AcronymText>{centerIdentity.secondary}</AcronymText></p> : null}
        </div>
        <dl>
          {centerPublication ? <div><dt>Publication</dt><dd>{centerPublication}</dd></div> : null}
          <div><dt>Record type</dt><dd>{displayNameFor("object_type", record.center_node.node_type)}</dd></div>
          <div>
            <dt>Published neighborhood</dt>
            <dd>{relationshipScopes.publishedNeighborhood.toLocaleString()} relationships</dd>
          </div>
          <div>
            <dt>Publisher-native structure</dt>
            <dd>{relationshipScopes.nativeStructure.toLocaleString()} relationships</dd>
          </div>
          <div>
            <dt>Cross-source</dt>
            <dd>{relationshipScopes.crossSource.toLocaleString()} relationships</dd>
          </div>
          {relationshipScopes.sameSourceContext ? (
            <div>
              <dt>Other typed context</dt>
              <dd>{relationshipScopes.sameSourceContext.toLocaleString()} relationships</dd>
            </div>
          ) : null}
        </dl>
        {centerPresentation && centerPublishedSections.length ? (
          <RecordPublishedTextPreview
            claimOrigin={centerClaimOrigin}
            fullRecordLabel="the full record"
            headingLevel={3}
            metadata={centerMetadata}
            sections={centerPresentation.sections}
          />
        ) : null}
        <div className="atlas-focused-exits">
          {retiresIntoAtlas(String(record.center_node.node_type || "")) ? null : (
            <AppLink
              onNavigate={onNavigate}
              patch={{ node: record.center_node.id }}
              variant="primary"
              view="library-detail"
            >
              {centerPublishedSections.length
                ? "Read the full record"
                : "Open the full record"}
            </AppLink>
          )}
          {centerOfficialSource.url ? (
            <ButtonLink
              href={centerOfficialSource.url}
              rel="noopener noreferrer"
              target="_blank"
              variant="secondary"
            >
              {centerClaimOrigin === "atlas_editorial"
                ? "View Atlas source"
                : officialSourceActionLabel(centerOfficialSource)}
            </ButtonLink>
          ) : null}
        </div>
      </section>
      {/* One record workspace, not three competing modes. Connections is the
          product; Hierarchy and the complete list are supporting panels.
          relationshipView still round-trips through the URL so every existing
          ?relationshipView=path|list deep link keeps working — it now decides
          which panel opens, not which product you get. */}
      <div className="atlas-focused-toolbar" id="atlas-connections-workspace">
        <div>
          <h2
            className="atlas-workspace-heading"
            id="atlas-connections-heading"
            tabIndex={-1}
          >
            Connections
          </h2>
          {/* Three lines of "typed context is separate from publisher-native
              hierarchy" sat directly above the connection graph and pushed it
              54px below the fold at 1440x900 — the one thing this route exists
              to show. It was also our vocabulary, not the reader's. */}
          <p className="atlas-workspace-orientation">
            Pick a relationship type to preview it, or open the full list.
          </p>
        </div>
        <div className="atlas-workspace-controls">
          <button
            aria-controls="atlas-hierarchy-panel"
            aria-expanded={hierarchyOpen}
            className={hierarchyOpen ? "atlas-panel-toggle active" : "atlas-panel-toggle"}
            onClick={() =>
              patchAtlas({ relationshipView: hierarchyOpen ? "map" : "path" })
            }
            type="button"
          >
            <IconRoute aria-hidden="true" size={17} />
            Hierarchy
          </button>
          <button
            aria-controls="atlas-all-connections"
            aria-expanded={listOpen}
            className={listOpen ? "atlas-panel-toggle active" : "atlas-panel-toggle"}
            onClick={() =>
              patchAtlas({ relationshipView: listOpen ? "map" : "list" })
            }
            type="button"
          >
            <IconListDetails aria-hidden="true" size={17} />
            View all
          </button>
          <AtlasFilterBar filters={filters} onChange={updateFilters} options={options} />
        </div>
      </div>

      {rows.length === 0 && !hierarchyOpen ? (
        <div id="atlas-focused-view">
          {noConnections}
        </div>
      ) : (
        <div className="atlas-focused-layout" id="atlas-focused-view">
          <section
            aria-label="Focused Atlas record"
            className="atlas-focused-main"
          >
            {hierarchyOpen ? (
              <section className="atlas-path-summary" id="atlas-hierarchy-panel">
                {/* No single eyebrow here: the chain below mixes Control
                    Atlas structure and publisher-declared hierarchy, and a
                    blanket "publisher-declared" claim over the whole thing
                    would be false. WhereThisSitsRail renders each as its own
                    labeled rail instead.
                    centerLabel was here too: the record's name is already the
                    page H1 and the last crumb of the chain below. */}
                {structuralPosition}

                <dl className="atlas-path-facts">
                  <div>
                    <dt>Publisher-native relationships</dt>
                    <dd>{relationshipScopes.nativeStructure.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Record type</dt>
                    <dd>
                      {displayNameFor(
                        "object_type",
                        record.center_node.node_type,
                      )}
                    </dd>
                  </div>
                  {centerPublication ? (
                    <div>
                      <dt>Publication</dt>
                      <dd>{centerPublication}</dd>
                    </div>
                  ) : null}
                  {!centerStableIdIsGenerated ? (
                    <div>
                      <dt>Identifier</dt>
                      <dd>{centerLabel}</dd>
                    </div>
                  ) : null}
                </dl>

                <section
                  aria-labelledby="atlas-path-children"
                  className="atlas-path-children"
                >
                  <h3 id="atlas-path-children">Decomposes into</h3>
                  {structuralChildren.length ? (
                    <>
                      <ul className="atlas-path-child-list">
                        {structuralChildren.map((child) => {
                          const childIdentity = identityForNode(child.id);
                          return (
                          <li key={child.id}>
                            <AppLink
                              aria-label={childIdentity.stableIdIsGenerated ? `Open ${childIdentity.accessibleName}` : undefined}
                              onNavigate={onNavigate}
                              patch={{ ...state, node: child.id, atlasParent: state.atlasParent || record.center_node.id, atlasStage: "", relationshipGroup: "" }}
                              title={child.title}
                              view="atlas-map"
                            >
                              {childIdentity.stableIdIsGenerated ? childIdentity.primary : child.itemId}
                            </AppLink>
                          </li>
                          );
                        })}
                      </ul>
                      <p className="muted">
                        {structuralChildren.length} child record
                        {structuralChildren.length === 1 ? "" : "s"}.
                      </p>
                    </>
                  ) : (
                    <p className="muted">
                      This record has no child records.
                    </p>
                  )}
                </section>

                <div className="card-actions atlas-path-actions">
                  <Button
                    onClick={() => patchAtlas({ relationshipView: "map" })}
                    type="button"
                    variant="primary"
                  >
                    See connections
                  </Button>
                  <AppLink onNavigate={onNavigate} patch={{ source: record.center_node.source_id }} variant="secondary" view="sources">
                    View source details
                  </AppLink>
                </div>
              </section>
            ) : null}

            {rows.length ? <AtlasConnectionMap
              center={record.center_node}
              compact={compact}
              expandedGroupId={state.relationshipGroup}
              groups={groups}
              identityForNode={identityForNode}
              onExpandedGroupChange={(relationshipGroup) =>
                patchAtlas({ relationshipGroup })
              }
              onOpenList={() => patchAtlas({ relationshipView: "list" })}
              onOpenRecord={onOpenRecordInContext}
              onSelectItem={setSelectedRow}
              selectedItemId={selectedRow?.counterpart.id || ""}
            /> : noConnections}

            {/* The complete relationship set supports the canvas instead of
                competing with it: same rows, classes, counts, and filters. */}
            {rows.length ? <section
              className="atlas-all-connections"
              id="atlas-all-connections"
            >
              {listOpen ? (
                <RelationshipGraphTable
                  centerNodeId={record.center_node.id}
                  conciseTrust
                  onOpenNode={onOpenNode}
                  rows={listRows}
                />
              ) : (
                <button
                  className="atlas-all-connections-toggle"
                  onClick={() => patchAtlas({ relationshipView: "list" })}
                  type="button"
                >
                  View all {rows.length} typed connections
                </button>
              )}
            </section> : null}

            {/* Published children stay on the workspace: they are the record's
                own decomposition, not a connection. */}
            {structuralChildren.length ? (
              <section className="atlas-workspace-children">
                <h3>Child records</h3>
                <ul className="atlas-path-child-list">
                  {structuralChildren.slice(0, 12).map((child) => {
                    const childIdentity = identityForNode(child.id);
                    return (
                    <li key={child.id}>
                      <button
                        aria-label={childIdentity.stableIdIsGenerated ? `Open ${childIdentity.accessibleName}` : undefined}
                        onClick={() =>
                          patchAtlas({
                            node: child.id,
                            atlasParent: state.atlasParent || record.center_node.id,
                            atlasStage: "",
                            relationshipGroup: "",
                          })
                        }
                        title={child.title}
                        type="button"
                      >
                        {childIdentity.stableIdIsGenerated ? childIdentity.primary : child.itemId}
                      </button>
                    </li>
                    );
                  })}
                </ul>
                {structuralChildren.length > 12 ? (
                  <p className="muted">
                    Showing 12 of {structuralChildren.length}. Open Hierarchy
                    for the full list.
                  </p>
                ) : null}
              </section>
            ) : null}
          </section>

          <aside
              aria-atomic="true"
              aria-label={selectedRow ? `${inspectedIdentity.accessibleName} record brief` : "Selected item"}
              aria-live="polite"
              className={`atlas-record-inspector header-offset-target${selectedRow ? " atlas-record-inspector--selected" : ""}`}
              ref={inspectorRef}
            >
              {/* When nothing is selected this must not restate AC-2 a third
                  time (page title, map center, here too) — it prompts toward
                  the map instead. */}
              {selectedRow ? (
                <>
                  <div className="atlas-inspector-heading">
                    <p className="eyebrow">
                      {displayNameFor(
                        "object_type",
                        inspectedDocument?.object_type || inspectedNode?.node_type,
                      )}
                    </p>
                    <h2>
                      <RecordLink
                        className="atlas-record-title-link"
                        nodeId={inspectedId}
                        onOpenNode={onOpenNode}
                      >
                        <AcronymText>{inspectedIdentity.primary}</AcronymText>
                      </RecordLink>
                    </h2>
                    {inspectedIdentity.stableIdIsGenerated ? (
                      <p><AcronymText>{inspectedIdentity.context}</AcronymText></p>
                    ) : showInspectedTitle && inspectedOfficialName ? (
                      <p><AcronymText>{inspectedOfficialName}</AcronymText></p>
                    ) : null}
                  </div>

                  {inspectedSynopsis && inspectedPresentation ? (
                    <section className="atlas-inspector-synopsis">
                      <h3>{inspectedPresentation.sections[0].heading}</h3>
                      <p>{inspectedSynopsis}</p>
                    </section>
                  ) : null}

                  {relationshipExplanation(selectedRow.edge) ? <section>
                    <h3>{relationshipExplanation(selectedRow.edge)?.label}</h3>
                    <p>{relationshipExplanation(selectedRow.edge)?.text}</p>
                  </section> : null}
                  <section className="atlas-inspector-source">
                    <h3>Evidence</h3>
                    <p>
                      {displayNameFor("relationship_type", selectedRow.edge.relationship_type)} in {selectedGroup?.label || "this connection group"}.
                    </p>
                    <p>
                      {selectedSource?.source_id
                        ? displayNameFor("source", selectedSource.source_id)
                        : displayNameFor("provenance_class", selectedRow.edge.provenance_class)}
                      {selectedSource?.locator ? `, ${selectedSource.locator}` : ""}
                    </p>
                  </section>
                </>
              ) : (
                <>
                  <div className="atlas-inspector-heading">
                    <p className="eyebrow">How to use this view</p>
                  </div>
                  <p className="atlas-inspector-count">
                    Choose a connection category, then select a record to inspect its relationship and source evidence here.
                  </p>
                </>
              )}

              <div className="atlas-inspector-actions">
                {selectedRow ? (
                  <AppLink
                    onNavigate={onNavigate}
                    onClick={(event) => {
                      if (shouldInterceptAppLink(event)) setSelectedRow(null);
                    }}
                    patch={{ ...state, node: selectedRow.counterpart.id, atlasParent: "", atlasStage: "", relationshipGroup: "", relationshipSearch: "" }}
                    variant="primary"
                    view="atlas-map"
                  >
                    <IconMap aria-hidden="true" size={18} />
                    See this record's connections
                  </AppLink>
                ) : null}
                {selectedRow ? (
                  <AppLink
                    onNavigate={onNavigate}
                    patch={selectedSource?.source_id ? { source: selectedSource.source_id } : undefined}
                    variant="secondary-quiet"
                    view="sources"
                  >
                    <IconFolderOpen aria-hidden="true" size={18} />
                    View source details
                  </AppLink>
                ) : null}
              </div>
            </aside>
        </div>
      )}
    </div>
  );
}

export function atlasDrilldownModel(
  bundle: Pick<RuntimeBundle, "atlasSpine" | "runtime">,
): AtlasDrilldownModel {
  if (!bundle.atlasSpine) {
    throw new Error("Atlas spine artifact is required for the Atlas hierarchy.");
  }
  const spineModel = buildAtlasBootstrapModel(bundle.atlasSpine);
  const fullModel = buildAtlasDrilldownModel(bundle.runtime.dataset);
  const hydratedSpineModel = hydrateAtlasFrameworkRecords(
    spineModel,
    bundle.runtime.dataset.nodes,
  );
  return {
    frameworkGroups: hydratedSpineModel.frameworkGroups,
    baselines: fullModel.baselines,
    rmfSteps: fullModel.rmfSteps,
  };
}

function AtlasGuidedPath(props: {
  bundle: RuntimeBundle;
  benchmarkRecord: AtlasNeighborhoodRecord | null;
  state: AtlasMapPageProps["state"];
  patchAtlas: (patch: Partial<AtlasMapPageProps["state"]>) => void;
  onNavigate: AtlasMapPageProps["onNavigate"];
  onOpenNode: AtlasMapPageProps["onOpenNode"];
}) {
  const { bundle, benchmarkRecord, state, patchAtlas, onNavigate, onOpenNode } = props;
  const axis =
    state.atlasAxis ||
    (state.sourceView === "rmf" ||
    state.relationshipView === "rmf"
      ? "process"
      : "");
  // Built always (not axis-gated) so the landing can render the trunk + limbs.
  const model = useMemo(
    () => atlasDrilldownModel(bundle),
    [bundle],
  );
  const recordLabels = useMemo(
    () => atlasProjectionRecordLabels(bundle.atlasNetwork),
    [bundle.atlasNetwork],
  );
  // Seeded from the URL so Start Here (and any shared link) can open straight
  // into one limb; further limb choices stay local to this page.
  const [openLimbId, setOpenLimbId] = useState(state.atlasLimb || "");
  // Re-sync when the URL's limb changes without this component unmounting —
  // back/forward and opening a different area's shared link while Explore is
  // already open both change state.atlasLimb without a remount, and openLimbId
  // must follow or the screen keeps showing the previous area.
  useEffect(() => {
    setOpenLimbId(state.atlasLimb || "");
  }, [state.atlasLimb]);
  const rmfStep = model.rmfSteps.find(
    (choice) => choice.id === state.atlasRmfStep,
  );

  const choiceLinks = useMemo(() => {
    const links = [
      { id: "atlas:root", label: "Atlas map" },
    ];
    if (axis === "process") {
      links.push({
        id: "process:rmf",
        label: "Risk Management Framework",
      });
      if (rmfStep) {
        links.push({
          id: `rmf-step:${rmfStep.id}`,
          label: rmfStep.itemId.replace("RMF-", ""),
        });
      }
    }
    return links;
  }, [axis, rmfStep]);

  function resetDrill(patch: Partial<AtlasMapPageProps["state"]>) {
    patchAtlas({
      atlasAxis: "",
      atlasLimb: "",
      atlasFramework: "",
      atlasBaseline: "",
      atlasFamily: "",
      atlasBenchmark: "",
      atlasRmfStep: "",
      node: "",
      atlasParent: "",
      ...patch,
    });
  }

  function openAncestor(id: string) {
    if (id === "atlas:root") {
      setOpenLimbId("");
      resetDrill({});
      return;
    }
    if (id === "process:rmf") {
      resetDrill({ atlasAxis: "process" });
    }
  }

  return (
    <section className="atlas-ancestry">
      {bundle.atlasSpine ? (
        <AtlasTree
          areaId={state.atlasLimb}
          benchmarkChildren={structuralChildrenFromNeighborhood(benchmarkRecord)}
          benchmarkId={state.atlasBenchmark}
          catalogSummaries={bundle.catalogSummaries || []}
          onOpenArea={(atlasLimb) => {
            setOpenLimbId(atlasLimb);
            resetDrill({ atlasAxis: "landscape", atlasLimb });
          }}
          onOpenCompare={() => onNavigate("matrix")}
          onOpenPublication={(atlasLimb, atlasFramework) => {
            setOpenLimbId(atlasLimb);
            resetDrill({ atlasAxis: "framework", atlasLimb, atlasFramework });
          }}
          onOpenSummary={(node, parentId) =>
            patchAtlas({ atlasFamily: "", atlasBenchmark: "", node, atlasParent: parentId, relationshipView: "path" })
          }
          onOpenRecord={(node, parentId) => patchAtlas({ node, atlasParent: parentId, relationshipView: "path" })}
          onReset={() => {
            setOpenLimbId("");
            resetDrill({});
          }}
          onSelectBenchmark={(atlasBenchmark) =>
            patchAtlas({ atlasBenchmark, atlasFamily: "", node: "", atlasParent: "" })
          }
          publicationId={state.atlasFramework}
          recordLabels={recordLabels}
          spine={bundle.atlasSpine}
          summaryId={state.atlasFamily}
        />
      ) : (
        <p role="alert">The Atlas view is unavailable. Reload the page to try again.</p>
      )}

      {axis === "process" ? (
        <ChoiceTrail links={choiceLinks} onOpen={openAncestor} />
      ) : null}

      {axis === "process" && !rmfStep ? (
        <>
          <p className="atlas-path-prompt">
            Which Risk Management Framework step are you working in?
          </p>
          <ol className="atlas-rmf-step-list">
            {model.rmfSteps.map((step, index) => (
              <li key={step.id}>
                <button
                  className="atlas-ancestry-choice"
                  onClick={() => patchAtlas({ atlasRmfStep: step.id })}
                  type="button"
                >
                  <span className="atlas-rmf-step-number">{index + 1}</span>
                  <span>
                    <strong>{step.itemId.replace("RMF-", "")}</strong>
                    <small>{step.label}</small>
                  </span>
                  <IconChevronRight aria-hidden="true" size={20} />
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {axis === "process" && rmfStep ? (
        <div className="atlas-rmf-results">
          <header>
            <p className="eyebrow">Related records</p>
            <h2>{rmfStep.label}</h2>
            <p>
              These records are linked to this step. A program may require
              additional work products.
            </p>
          </header>
          {rmfStep.results.length ? (
            <ul className="atlas-path-record-list">
              {rmfStep.results.map((result) => {
                const identity = runtimeRecordIdentityFor(bundle, result.id);
                return (
                <li key={`${result.id}:${result.relationshipType}`}>
                  <RecordLink
                    aria-label={identity.stableIdIsGenerated ? `Open ${identity.accessibleName}` : undefined}
                    className="atlas-path-record"
                    nodeId={result.id}
                    onOpenNode={onOpenNode}
                  >
                    <span className="atlas-path-record-text">
                      <strong>{identity.stableIdIsGenerated ? identity.primary : result.itemId}</strong>
                      {identity.stableIdIsGenerated && identity.context ? (
                        <small>{identity.context}</small>
                      ) : <small>{result.label}</small>}
                    </span>
                    <span className="badge tone-applicability">
                      {displayNameFor("relationship_type", result.relationshipType)}
                    </span>
                    <IconChevronRight aria-hidden="true" size={20} />
                  </RecordLink>
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">
              No records are connected to this step.
            </p>
          )}
          <aside className="atlas-rmf-template-note">
            <div>
              <strong>Need a document or work product?</strong>
              <p>
                Templates are organized by program and task.
              </p>
            </div>
            <AppLink onNavigate={onNavigate} variant="secondary" view="templates">
              Browse templates
            </AppLink>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function ChoiceTrail(props: {
  links: Array<{ id: string; label: string }>;
  onOpen: (id: string) => void;
}) {
  return (
    <nav aria-label="Your choices" className="atlas-choice-trail">
      <strong>Your choices</strong>
      {props.links.map((link, index) => (
        <span key={link.id}>
          {index > 0 ? (
            <IconChevronRight aria-hidden="true" size={15} />
          ) : null}
          {index === props.links.length - 1 ? (
            <span>{link.label}</span>
          ) : (
            <button onClick={() => props.onOpen(link.id)} type="button">
              {link.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function AtlasFilterBar(props: {
  filters: AtlasFilterState;
  options: ReturnType<typeof atlasFilterOptions>;
  onChange: (patch: Partial<AtlasFilterState>) => void;
}) {
  return (
    <details className="atlas-connection-filters">
      <summary>Filter connections</summary>
      <div aria-label="Connection filters" className="atlas-filter-grid" role="group">
        <AtlasSelect
          label="Connection type"
          onChange={(relationshipType) => props.onChange({ relationshipType })}
          options={props.options.relationshipTypes}
          value={props.filters.relationshipType}
          vocabulary="relationship_type"
        />
        <AtlasSelect
          label="Evidence"
          onChange={(provenance) => props.onChange({ provenance })}
          options={props.options.provenanceClasses}
          value={props.filters.provenance}
          vocabulary="provenance_class"
        />
        <AtlasSelect
          label="Trust level"
          onChange={(confidence) => props.onChange({ confidence })}
          options={props.options.confidenceLevels}
          value={props.filters.confidence}
          vocabulary="confidence"
        />
        <AtlasSelect
          label="Item type"
          onChange={(nodeType) => props.onChange({ nodeType })}
          options={props.options.nodeTypes}
          value={props.filters.nodeType}
          vocabulary="object_type"
        />
        <label>
          Filter this record's connections
          <input
            onChange={(event) => props.onChange({ search: event.target.value })}
            placeholder="ID, title, or rationale"
            type="search"
            value={props.filters.search}
          />
        </label>
        <label className="atlas-candidate-toggle">
          <input
            checked={props.filters.includeCandidates}
            onChange={(event) =>
              props.onChange({ includeCandidates: event.target.checked })
            }
            type="checkbox"
          />
          Include candidate links
        </label>
      </div>
    </details>
  );
}

function AtlasSelect(props: {
  label: string;
  value: string;
  options: string[];
  vocabulary: string;
  onChange: (value: string) => void;
}) {
  const id = `atlas-filter-${props.label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <label htmlFor={id}>
      {props.label}
      <select id={id} onChange={(event) => props.onChange(event.target.value)} value={props.value}>
        <option value="">All</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {displayNameFor(props.vocabulary, option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AtlasNoConnections(props: {
  candidateCount: number;
  filtersActive: boolean;
  includeCandidates: boolean;
  onClear: () => void;
  onIncludeCandidates: () => void;
  onNavigate: AtlasMapPageProps["onNavigate"];
  query: string;
}) {
  return (
    <section className="atlas-no-connections" role="status">
      <IconMap aria-hidden="true" size={28} />
      <h2>No connections found.</h2>
      <p>
        {props.filtersActive
          ? "No connections match the current filters."
          : "No relationships are available for this record."}
      </p>
      <div className="card-actions">
        {props.filtersActive ? (
          <Button variant="primary" onClick={props.onClear} type="button">Clear filters</Button>
        ) : null}
        {!props.includeCandidates && props.candidateCount > 0 ? (
          <Button variant="secondary" onClick={props.onIncludeCandidates} type="button">
            Show {props.candidateCount} candidate links
          </Button>
        ) : null}
        <AppLink onNavigate={props.onNavigate} patch={{ query: props.query }} variant="secondary" view="search">Search the Library</AppLink>
      </div>
    </section>
  );
}

function AtlasLoadFailure(props: {
  error: boolean;
  onNavigate: AtlasMapPageProps["onNavigate"];
  query: string;
}) {
  return (
    <section className="atlas-no-connections" role="alert">
      <h2>{props.error ? "Connections could not be loaded." : "Record not found."}</h2>
      <p>{props.error ? "Try again or search the Library." : "This record is not in the current Library index."}</p>
      <div className="card-actions">
        <AppLink onNavigate={props.onNavigate} patch={{ query: props.query }} variant="primary" view="search">Search records</AppLink>
      </div>
    </section>
  );
}
