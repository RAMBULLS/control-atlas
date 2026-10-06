import { useLayoutEffect, useRef } from "react";
import { Button } from "./lsm";

export function ListPagination(props: {
  label: string;
  noun: string;
  start: number;
  end: number;
  total: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const navigation = useRef<HTMLElement>(null);
  const preserveFocus = useRef(false);
  const changePage = (page: number) => {
    preserveFocus.current = Boolean(navigation.current?.contains(document.activeElement));
    props.onPageChange(page);
  };
  useLayoutEffect(() => {
    if (!preserveFocus.current) return;
    preserveFocus.current = false;
    const active = document.activeElement;
    if (!navigation.current?.contains(active) || (active instanceof HTMLButtonElement && active.disabled)) {
      navigation.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    }
  }, [props.page]);
  if (props.pageCount <= 1) return null;
  return (
    <nav aria-label={props.label} className="compare-pagination" ref={navigation}>
      <p className="compare-pagination-caption" role="status">
        Showing {props.noun} {props.start.toLocaleString()}-{props.end.toLocaleString()} of {props.total.toLocaleString()}.
      </p>
      <div className="compare-pagination-actions">
        <Button disabled={props.page <= 1} onClick={() => changePage(props.page - 1)} type="button" variant="secondary">Previous page</Button>
        <Button disabled={props.page >= props.pageCount} onClick={() => changePage(props.page + 1)} type="button" variant="secondary">Next page</Button>
        <Button disabled={props.page >= props.pageCount} onClick={() => changePage(props.pageCount)} type="button" variant="secondary">Last page</Button>
      </div>
    </nav>
  );
}
