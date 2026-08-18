import { IconArrowLeft, IconArrowRight, IconSearch } from "@tabler/icons-react";
import { SITE_COPY } from "../../shared/site-copy.mjs";

import {
  START_HERE_CONTEXTS,
  START_HERE_GOALS,
  labelForContext,
  labelForGoal,
  publicationNameFor,
  startingPlanFor,
} from "../../app/start-here-guide.mjs";
import { Button } from "../components/lsm";
import { AppLink } from "../components/AppLink";
import { catalogProfileFor } from "../lib/catalogProfiles";
import {
  MissionPage,
  MissionWorkspace,
  PageHeader,
  SupportRail,
} from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

type StartHereState = Extract<ViewState, { view: "start-here" }>;

const STEPS = [
  { id: "goal", label: "Goal" },
  { id: "context", label: "Context" },
  { id: "plan", label: "Starting plan" },
];

function publicationName(bundle: RuntimeBundle | null, catalogId: string) {
  return bundle?.runtime?.getCatalogs?.()?.find((entry: any) => entry.id === catalogId)?.name || publicationNameFor(catalogId);
}

function PlanStep(props: {
  role: string;
  catalogId: string;
  bundle: RuntimeBundle | null;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const name = publicationName(props.bundle, props.catalogId);
  return (
    <AppLink className="start-here-publication" onNavigate={props.onNavigate} patch={{ catalog: props.catalogId }} view="catalog-detail">
      <span>
        <small>{props.role}</small>
        <strong>{name}</strong>
        <span>{catalogProfileFor(props.catalogId, name).synopsis}</span>
      </span>
      <IconArrowRight aria-hidden="true" size={18} />
    </AppLink>
  );
}

export function StartHerePage(props: {
  bundle?: RuntimeBundle | null;
  state: StartHereState;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
}) {
  const { bundle = null, state, onNavigate } = props;
  const plan = startingPlanFor(state.goal, state.context);
  const step = !state.goal ? 1 : !state.context ? 2 : 3;
  const update = (patch: Partial<StartHereState>) => onNavigate("start-here", { ...state, ...patch });

  return (
    <MissionPage className="start-here-page" data-visual-identity="task-intake-compass" maxWidth="workspace">
      <PageHeader primary summary={SITE_COPY.routes.start.purpose} title={SITE_COPY.routes.start.title} />

      <nav aria-label="Step progress" className={`progress-trajectory progress-trajectory--step-${step}`}>
        {STEPS.map((s, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum < step;
          const isActive = stepNum === step;
          return (
            <div className={`step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`.trim()} key={s.id}>
              {`0${stepNum} / ${s.label.toUpperCase()}`}
            </div>
          );
        })}
      </nav>

      <MissionWorkspace>
        <div className="start-here-main-task">
          {step === 1 ? (
            <section aria-labelledby="start-here-goal" className="start-here-step">
              <span className="label">01 / GOAL</span>
              <h2 id="start-here-goal">What are you trying to do?</h2>
              <p>Choose the work in front of you.</p>
              <div className="start-here-choice-grid">
                {START_HERE_GOALS.map((goal: { id: string; label: string }) => (
                  <button key={goal.id} onClick={() => update({ goal: goal.id, context: "" })} type="button">
                    <span>{goal.label}</span>
                    <IconArrowRight aria-hidden="true" size={17} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="start-here-context" className="start-here-step">
              <span className="label">02 / CONTEXT</span>
              <h2 id="start-here-context">What kind of system are you working with?</h2>
              <p>This opens the right publication first.</p>
              <div className="start-here-choice-grid">
                {START_HERE_CONTEXTS.map((context: { id: string; label: string }) => (
                  <button key={context.id} onClick={() => update({ context: context.id })} type="button">
                    <span>{context.label}</span>
                    <IconArrowRight aria-hidden="true" size={17} />
                  </button>
                ))}
              </div>
              <div className="card-actions">
                <Button onClick={() => update({ goal: "", context: "" })} type="button" variant="secondary">
                  <IconArrowLeft aria-hidden="true" size={17} />
                  Back to goal
                </Button>
              </div>
            </section>
          ) : null}

          {step === 3 && plan ? (
            <section aria-labelledby="start-here-plan" className="start-here-step start-here-plan">
              <span className="label">03 / STARTING PLAN</span>
              <h2 id="start-here-plan">Start with {publicationName(bundle, plan.startWith.catalogId)}</h2>
              <p>Based on your answers, begin with this publication.</p>
              <p className="notice-inline">{SITE_COPY.product.boundary}</p>
              <div className="start-here-primary-destination">
                <span>
                  <small>Next destination</small>
                  <strong>{publicationName(bundle, plan.startWith.catalogId)}</strong>
                  <span>Open the publication and choose a record.</span>
                </span>
                <AppLink onNavigate={onNavigate} patch={{ catalog: plan.startWith.catalogId }} variant="primary" view="catalog-detail">
                  Open {publicationName(bundle, plan.startWith.catalogId)}
                  <IconArrowRight aria-hidden="true" size={17} />
                </AppLink>
              </div>
              <div className="start-here-followups">
                <PlanStep bundle={bundle} catalogId={plan.thenReview.catalogId} onNavigate={onNavigate} role="Then review" />
                <AppLink
                  className="start-here-publication"
                  onNavigate={onNavigate}
                  patch={plan.action.patch as Partial<ViewState> | undefined}
                  view={plan.action.view as ViewState["view"]}
                >
                  <span>
                    <small>Then act</small>
                    <strong>{plan.action.label}</strong>
                    <span>Open the next step for this task.</span>
                  </span>
                  <IconArrowRight aria-hidden="true" size={18} />
                </AppLink>
              </div>
              <div className="card-actions">
                <Button onClick={() => update({ context: "" })} type="button" variant="secondary">
                  <IconArrowLeft aria-hidden="true" size={17} />
                  Back to context
                </Button>
                <Button onClick={() => update({ goal: "", context: "" })} type="button" variant="secondary">
                  Start over
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <SupportRail sticky>
          <section aria-label="Your answers" className="panel start-here-support-panel">
            <span className="label">YOUR SELECTIONS</span>
            <div className="start-here-answers-list">
              {state.goal ? (
                <div className="start-here-answer-card">
                  <small>01 / Goal</small>
                  <strong>{labelForGoal(state.goal)}</strong>
                  <button
                    className="start-here-change-btn"
                    onClick={() => update({ goal: "", context: "" })}
                    type="button"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="start-here-empty-slot">
                  <small>01 / Goal</small>
                  <span>Choose your work in the active step.</span>
                </div>
              )}

              {state.context ? (
                <div className="start-here-answer-card">
                  <small>02 / Context</small>
                  <strong>{labelForContext(state.context)}</strong>
                  <button
                    className="start-here-change-btn"
                    onClick={() => update({ context: "" })}
                    type="button"
                  >
                    Change
                  </button>
                </div>
              ) : step >= 2 ? (
                <div className="start-here-empty-slot">
                  <small>02 / Context</small>
                  <span>Choose your system context in the active step.</span>
                </div>
              ) : null}
            </div>
          </section>

          <div className="start-here-search-link">
            <AppLink onNavigate={onNavigate} patch={{ query: "" }} variant="secondary" view="search">
              <IconSearch aria-hidden="true" size={18} />
              Search the Library instead
            </AppLink>
          </div>
        </SupportRail>
      </MissionWorkspace>
    </MissionPage>
  );
}
