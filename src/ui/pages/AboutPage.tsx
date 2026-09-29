import { ATLAS_SCOPE_METRICS } from "../../shared/atlas-presentation";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { PageHeader, PageJumpNav } from "../lib/pagePrimitives";

const SUPPORT_URL = "https://buymeacoffee.com/ram.bulls";
const PROJECT_URL = "https://github.com/RAMBULLS/control-atlas";
const REPORT_URL = `${PROJECT_URL}/issues/new?template=report-broken-link.yml`;
const CONTRIBUTE_URL = `${PROJECT_URL}/blob/main/CONTRIBUTING.md`;

const ABOUT_SECTIONS = [
  { id: "about-purpose", label: "Why it exists" },
  { id: "about-work", label: "Find your way through the work" },
  { id: "about-sources", label: "Sources and limits" },
  { id: "about-project", label: "Open source and community" },
];

export function AboutPage() {
  return (
    <section className="ca-page about-page" data-page-template="knowledge-base">
      <PageHeader primary summary={SITE_COPY.routes.about.purpose} title={SITE_COPY.routes.about.title} />

      <div className="about-layout">
        <article className="learn-article">
          <section id="about-purpose">
            <h2>Make sense of the material behind the work</h2>
            <p>
              Control Atlas is a free research tool for people working with federal
              cybersecurity requirements. It brings public controls, STIGs,
              assessment procedures, baselines, threats, and guidance into one
              place, with links back to the publishers.
            </p>
            <p>
              It is for assessors, system teams, security engineers, and anyone
              who needs to find a source, understand where it fits, and decide
              what to examine next. You can use it without an account.
            </p>
            <p><a href="#/atlas">Explore work in Atlas</a> or <a href="#/library">search the Library</a>.</p>
            {ATLAS_SCOPE_METRICS ? (
              <p>
                The Library currently holds {ATLAS_SCOPE_METRICS.records.toLocaleString("en-US")}
                {" "}searchable records from {ATLAS_SCOPE_METRICS.publications.toLocaleString("en-US")}
                {" "}source publications.
              </p>
            ) : null}
          </section>

          <section id="about-work">
            <h2>Find your way through the work</h2>
            <p>
              <a href="#/atlas">Atlas</a> starts with practitioner topics such as RMF,
              STIGs, and FedRAMP and leads to the relevant publications and records.
              {" "}<a href="#/library">Library</a> lets you search the published material
              by name, topic, or identifier.
            </p>
            <p>
              <a href="#/compare">Compare</a> shows connections that a source
              actually publishes, with that source beside each result. Use
              {" "}<a href="#/build">Templates</a> to set up a working file for a task;
              the file still needs your own decisions and evidence. In
              {" "}<a href="#/resources">Resources</a>, find official portals,
              practitioner tools, training, and communities that help with the work.
            </p>
          </section>

          <section id="about-sources">
            <h2>Check the source before you act</h2>
            <p>
              Control Atlas tracks publisher material and checks for updates.
              {" "}<a href="#/sources">Sources</a> shows who published an item, which
              edition is included, when it was checked, and any known gap.
              Publisher text and published connections stay separate from Control
              Atlas explanations and navigation.
            </p>
            <p>
              Control Atlas is not a government system. It does not decide what
              applies to your system, prove that a control is met, establish
              equivalence between frameworks, or grant an authorization. Use the
              official source and your responsible authority for those decisions.
            </p>
          </section>

          <section id="about-project">
            <h2>Built in the open</h2>
            <p>
              Control Atlas is a RAM.BULLS project, free and open source under
              the MIT license. You can <a href={PROJECT_URL} rel="noopener noreferrer" target="_blank">read the code</a>,
              {" "}<a href={CONTRIBUTE_URL} rel="noopener noreferrer" target="_blank">contribute</a>,
              {" "}<a href={REPORT_URL} rel="noopener noreferrer" target="_blank">report a broken link or source problem</a>,
              {" "}or <a href={SUPPORT_URL} rel="noopener noreferrer" target="_blank">support the project</a>.
            </p>
          </section>
        </article>

        <aside aria-label="On this page" className="about-toc">
          <p className="label">On this page</p>
          <PageJumpNav ariaLabel="Jump to About section" sections={ABOUT_SECTIONS} />
        </aside>
      </div>
    </section>
  );
}
