import { AppLink } from "./AppLink";
import { BUILD_LANES } from "../lib/buildRouteState";
import type { ViewState } from "../lib/viewState";

type BuildBranch = "tasks" | "documents" | "resources";

// Resources has its own place in the main navigation, so it is not repeated
// here. The two lanes left are two ways into the same working files.
const LOCAL_LANE_LABELS: Record<string, string> = {
  tasks: "By task",
  documents: "All working files",
};

export function BuildLocalNav(props: {
  active: BuildBranch;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { active, onNavigate } = props;
  return (
    <nav aria-label="Template sections" className="build-local-nav flex flex-wrap gap-[8px] border-b border-[var(--ca-border)] pb-[16px] mb-[24px]">
      {BUILD_LANES.filter((item) => item.id !== "resources").map((item) => (
        <AppLink aria-current={active === item.id ? "page" : undefined} key={item.id} onNavigate={onNavigate} patch={{ buildSection: item.id as "tasks" | "documents", task: "", templateType: "" }} variant={active === item.id ? "primary" : "secondary"} view="templates">
          {LOCAL_LANE_LABELS[item.id] || item.label}
        </AppLink>
      ))}
    </nav>
  );
}
