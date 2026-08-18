import {
  PRODUCT_DECISION_BOUNDARY,
  PRODUCT_DEFINITION,
} from "../../shared/product-identity";
import { SITE_COPY } from "../../shared/site-copy.mjs";
import { MissionPage, PageHeader, PageJumpNav } from "../lib/pagePrimitives";

const ABOUT_SECTIONS = [
  { id: "about-what-it-is", label: "What Control Atlas is" },
  { id: "about-how-it-is-organized", label: "How it is organized" },
  { id: "about-sources-and-crosswalks", label: "How sources and crosswalks work" },
  { id: "about-what-it-does-not-decide", label: "What Control Atlas does not decide" },
  { id: "about-the-project", label: "About the project" },
];

export function AboutPage() {
  return (
    <MissionPage className="about-page" maxWidth="content">
      <PageHeader primary summary={SITE_COPY.routes.about.purpose} title={SITE_COPY.routes.about.title} />

      <div className="about-layout">
        <article className="about-article">
          <section aria-labelledby="heading-what-it-is" className="about-section" id="about-what-it-is">
            <h2 id="heading-what-it-is">What Control Atlas is</h2>
            <p>{PRODUCT_DEFINITION}</p>
            <p>
              Security teams inherit guidance from many publishers, formats, and
              levels of detail. Control Atlas exists to make that guidance
              navigable together: find the source record, see its declared
              structure and evidence-backed connections, then move to the next
              piece of work without rebuilding the map by hand.
            </p>
            <p>
              Control Atlas isn't a GRC, assessment, or ticketing system. It's
              where ISSMs, engineers, assessors, and program teams orient
              themselves, compare guidance, and get the next action moving.
              No account or upload is required. Document work runs in the browser
              and does not store organizational data.
            </p>
          </section>

          <section aria-labelledby="heading-how-it-is-organized" className="about-section" id="about-how-it-is-organized">
            <h2 id="heading-how-it-is-organized">How it is organized</h2>
            <p>
              <strong>Control Atlas structure:</strong> How Control Atlas organizes topics connects federal authority, Cybersecurity, and its areas. See the Path rail on any record for how Control Atlas structure and the publisher's original structure are identified.
            </p>
            <p>
              Nine areas — Governance, Risk, Compliance, Architecture,
              Implementation, Assessment, Operations, Threats &amp; Defense, and
              Knowledge — organize the cybersecurity landscape. Every publisher
              keeps its own real structure underneath; the nine areas are a
              Control Atlas navigation layer for orientation, not a replacement for how
              NIST, DISA, or any other publisher organizes its own material.
            </p>
          </section>

          <section aria-labelledby="heading-sources-and-crosswalks" className="about-section" id="about-sources-and-crosswalks">
            <h2 id="heading-sources-and-crosswalks">How sources and crosswalks work</h2>
            <p>
              Control Atlas keeps a publisher's original structure separate from the
              connections it draws between sources, and shows official IDs and
              links for both. A mention in the text alone doesn't mean a
              technology or control applies — you decide that.
            </p>
            <p>
              Every publication, mapping, and connection names its publisher,
              cited version, and the date it was last checked. Mappings between
              frameworks show their source and how the connection was established rather than
              presenting every connection as equally certain. See Sources for
              the full source details behind any record.
            </p>
          </section>

          <section aria-labelledby="heading-what-it-does-not-decide" className="about-section" id="about-what-it-does-not-decide">
            <h2 id="heading-what-it-does-not-decide">What Control Atlas does not decide</h2>
            <p>{PRODUCT_DECISION_BOUNDARY}</p>
          </section>

          <section aria-labelledby="heading-about-the-project" className="about-section" id="about-the-project">
            <h2 id="heading-about-the-project">About the project</h2>
            <p>
              Control Atlas is open source under the MIT license and is not a
              government system. Publication details and update dates are
              available on each record.
            </p>
          </section>
        </article>

        <aside aria-label="On this page" className="about-toc">
          <p className="label">On this page</p>
          <PageJumpNav ariaLabel="Jump to About section" sections={ABOUT_SECTIONS} />
        </aside>
      </div>
    </MissionPage>
  );
}
