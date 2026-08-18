import { AppLink } from "./AppLink";
import { BUILD_LANES } from "../lib/buildRouteState";
import type { ViewState } from "../lib/viewState";

type BuildBranch = "tasks" | "documents" | "resources";

export function BuildLocalNav(props: {
  active: BuildBranch;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { active, onNavigate } = props;
  return (
    <nav aria-label="Build sections" className="build-local-nav">
      {BUILD_LANES.map((item) => (
        <AppLink
          aria-current={active === item.id ? "page" : undefined}
          className={`build-local-nav-link ${active === item.id ? "active" : ""}`}
          key={item.id}
          onNavigate={onNavigate}
          patch={item.id === "resources" ? undefined : { buildSection: item.id, task: "", templateType: "" }}
          variant="secondary"
          view={item.id === "resources" ? "commons" : "templates"}
        >
          {item.label}
        </AppLink>
      ))}
    </nav>
  );
}
