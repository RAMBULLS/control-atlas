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
import { MissionPage, PageHeader, StepIndicator, stepEyebrow, type FlowStep } from "../lib/pagePrimitives";
import type { RuntimeBundle } from "../lib/runtimeLoader";
import type { ViewState } from "../lib/viewState";

type StartHereState = Extract<ViewState, { view: "start-here" }>;

const START_HERE_STEPS: readonly FlowStep[] = [
  { id: "goal", label: "Goal" },
  { id: "context", label: "Context" },
  { id: "plan", label: "Your plan", outcome: true },
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
    <MissionPage
      className="flow-shell start-here-page"
      data-visual-identity="task-intake-compass"
      maxWidth="workspace"
    >
      <PageHeader primary summary={SITE_COPY.routes.start.purpose} title={SITE_COPY.routes.start.title} />

      <StepIndicator currentStep={step} steps={START_HERE_STEPS} />

      <section className="compare-flow-grid">
        <section className="compare-flow-task panel">
          {step === 1 ? (
            <div aria-labelledby="start-here-goal" className="stack">
              <span className="label">{stepEyebrow(START_HERE_STEPS, "goal")}</span>
              <h2 id="start-here-goal">What are you trying to do?</h2>
              <p>Choose the work in front of you.</p>
              <div className="start-here-choice-grid">
                {START_HERE_GOALS.map((goal: { id: string; label: string }) => <button key={goal.id} onClick={() => update({ goal: goal.id, context: "" })} type="button"><span>{goal.label}</span><IconArrowRight aria-hidden="true" size={17} /></button>)}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div aria-labelledby="start-here-context" className="stack">
              <span className="label">{stepEyebrow(START_HERE_STEPS, "context")}</span>
              <h2 id="start-here-context">What kind of system are you working with?</h2>
              <p>This opens the right publication first.</p>
              <div className="start-here-choice-grid">
                {START_HERE_CONTEXTS.map((context: { id: string; label: string }) => <button key={context.id} onClick={() => update({ context: context.id })} type="button"><span>{context.label}</span><IconArrowRight aria-hidden="true" size={17} /></button>)}
              </div>
              <div className="actions compare-step-actions">
                <Button onClick={() => update({ goal: "", context: "" })} type="button" variant="secondary"><IconArrowLeft aria-hidden="true" size={17} />Back to goal</Button>
              </div>
            </div>
          ) : null}

          {step === 3 && plan ? (
            <div aria-labelledby="start-here-plan" className="stack start-here-plan">
              <span className="label">{stepEyebrow(START_HERE_STEPS, "plan")}</span>
              <h2 id="start-here-plan">Start with {publicationName(bundle, plan.startWith.catalogId)}</h2>
              <p>Based on your answers, begin with this publication.</p>
              {/* The plan's own first move lives in the plan. It used to exist
                  only in the side rail, which on phones sits below Back and
                  Start over, so the one action the plan recommends came last. */}
              <div className="start-here-primary-action">
                <AppLink onNavigate={onNavigate} patch={{ catalog: plan.startWith.catalogId }} variant="primary" view="catalog-detail">Open {publicationName(bundle, plan.startWith.catalogId)}<IconArrowRight aria-hidden="true" size={17} /></AppLink>
              </div>
              <p className="notice-inline">{SITE_COPY.product.boundary}</p>
              <div className="start-here-followups">
                <PlanStep bundle={bundle} catalogId={plan.thenReview.catalogId} onNavigate={onNavigate} role="Then review" />
                <AppLink className="start-here-publication" onNavigate={onNavigate} patch={plan.action.patch as Partial<ViewState> | undefined} view={plan.action.view as ViewState["view"]}><span><small>Then act</small><strong>{plan.action.view === "templates" ? "Choose a template" : plan.action.label}</strong><span>Open the next step for this task.</span></span><IconArrowRight aria-hidden="true" size={18} /></AppLink>
              </div>
              <div className="actions compare-step-actions">
                <Button onClick={() => update({ context: "" })} type="button" variant="secondary"><IconArrowLeft aria-hidden="true" size={17} />Back to context</Button>
                <Button onClick={() => update({ goal: "", context: "" })} type="button" variant="secondary">Start over</Button>
              </div>
            </div>
          ) : null}
        </section>

        <aside aria-labelledby="start-here-summary-heading" className="compare-flow-support panel">
          <span className="label">Preserved context</span>
          <h2 id="start-here-summary-heading">Your answers</h2>
          {state.goal ? (
            <dl className="compare-scope-list">
              <div>
                <dt>Goal</dt>
                <dd>{labelForGoal(state.goal)}</dd>
              </div>
              {state.context ? (
                <div>
                  <dt>Context</dt>
                  <dd>{labelForContext(state.context)}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p>Your choices stay visible as you move through the flow.</p>
          )}

          {step === 1 ? <p><strong>Next:</strong> choose your goal.</p> : null}
          {step === 2 ? (
            <>
              <p><strong>Next:</strong> choose the system context.</p>
              <Button onClick={() => update({ goal: "", context: "" })} type="button" variant="secondary">Change goal</Button>
            </>
          ) : null}
        </aside>
      </section>

      <div className="start-here-search-link"><AppLink onNavigate={onNavigate} patch={{ query: "" }} variant="secondary" view="search"><IconSearch aria-hidden="true" size={18} />Search the Library instead</AppLink></div>
    </MissionPage>
  );
}
