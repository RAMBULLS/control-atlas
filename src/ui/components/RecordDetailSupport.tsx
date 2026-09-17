import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import "../../../styles/record-detail.css";

/** Native details owns user toggles; breakpoint changes set the initial layout state. */
export function RecordRailSection(props: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  accent?: boolean;
}) {
  const headingId = useId();
  const element = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      const details = element.current;
      if (!details) return;
      if (media.matches && details.contains(document.activeElement)) {
        details.querySelector<HTMLElement>("summary")?.focus();
      }
      // Do not mirror native toggle events into React state: delayed toggle
      // events can otherwise undo a rapid keyboard or breakpoint transition.
      details.open = !media.matches;
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <details
      aria-labelledby={headingId}
      className={`ca-record-rail${props.accent ? " ca-record-rail--actions" : ""}`}
      data-rail-section={props.id}
      open
      ref={element}
    >
      <summary className="ca-record-rail__heading">
        <span aria-hidden="true" className="ca-record-rail__icon">{props.icon}</span>
        <h2 id={headingId}>{props.title}</h2>
        <IconChevronRight aria-hidden="true" className="ca-record-rail__chevron" size={18} />
      </summary>
      <div className="ca-record-rail__body">{props.children}</div>
    </details>
  );
}

/** A scroll action must not replace the hash used by the application's router. */
export function scrollToRecordSection(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  return true;
}

export function RecordJumpButton(props: {
  targetId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      className={props.className || "ca-record-rail__jump"}
      onClick={() => scrollToRecordSection(props.targetId)}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function RecordSectionNavigation(props: {
  items: Array<{ id: string; label: string }>;
}) {
  const [active, setActive] = useState("");
  const key = props.items.map((item) => item.id).join("|");

  useEffect(() => {
    const ids = key.split("|").filter(Boolean);
    setActive(ids[0] || "");
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length) setActive(visible[0].target.id);
    }, { rootMargin: "-10% 0px -65% 0px", threshold: 0 });
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [key]);

  if (props.items.length < 2) return null;
  return (
    <nav aria-label="Record sections" className="record-section-nav ca-record-section-nav">
      {props.items.map((item) => (
        <button
          aria-current={active === item.id ? "location" : undefined}
          className="ca-record-section-nav__item"
          key={item.id}
          onClick={() => {
            if (scrollToRecordSection(item.id)) setActive(item.id);
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
