import {
  IconCompass,
  IconFileText,
  IconGitCompare,
  IconInfoCircle,
  IconLibrary,
  IconRocket,
  IconTopologyStar3,
  IconUsersGroup,
  IconSourceCode,
} from "@tabler/icons-react";

import type { ViewState } from "./viewState";
import { routeIdentityFor } from "./routeIdentity";
export {
  activeNavForState,
  isStaticViewWithoutBundle,
  requiresFullGraph,
} from "./navigationState";

export type NavItem = {
  label: string;
  view: ViewState["view"];
  path: string;
  icon: typeof IconCompass;
  patch?: Record<string, string>;
  section: "discovery" | "toolkit" | "utility";
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const PRIMARY_SECTION_LABEL = "Explore Control Atlas";
export const UTILITY_SECTION_LABEL = "Guides and information";

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    label: routeIdentityFor("start-here").label,
    view: "start-here",
    path: routeIdentityFor("start-here").path,
    icon: IconRocket,
    section: "discovery",
  },
  {
    label: routeIdentityFor("atlas-map").label,
    view: "atlas-map",
    path: routeIdentityFor("atlas-map").path,
    icon: IconTopologyStar3,
    section: "discovery",
  },
  {
    label: routeIdentityFor("search").label,
    view: "search",
    path: routeIdentityFor("search").path,
    icon: IconLibrary,
    section: "discovery",
  },
  {
    label: routeIdentityFor("matrix").label,
    view: "matrix",
    path: routeIdentityFor("matrix").path,
    icon: IconGitCompare,
    section: "discovery",
  },
  {
    label: routeIdentityFor("commons").label,
    view: "commons",
    path: routeIdentityFor("commons").path,
    icon: IconUsersGroup,
    section: "discovery",
  },
];

export const DOCUMENTS_NAV_ITEM: NavItem = {
  label: routeIdentityFor("templates").label,
  view: "templates",
  path: routeIdentityFor("templates").path,
  icon: IconFileText,
  section: "toolkit",
};

export const GUIDES_NAV_ITEM: NavItem = {
  label: routeIdentityFor("patterns").label,
  view: "patterns",
  path: routeIdentityFor("patterns").path,
  icon: IconCompass,
  section: "toolkit",
};

export const UTILITY_NAV_ITEMS: NavItem[] = [
  {
    label: routeIdentityFor("sources").label,
    view: "sources",
    path: routeIdentityFor("sources").path,
    icon: IconSourceCode,
    section: "utility",
  },
  {
    label: routeIdentityFor("about").label,
    view: "about",
    path: routeIdentityFor("about").path,
    icon: IconInfoCircle,
    section: "utility",
  },
];

export const OVERFLOW_NAV_ITEMS: NavItem[] = [
  DOCUMENTS_NAV_ITEM,
  GUIDES_NAV_ITEM,
  ...UTILITY_NAV_ITEMS,
];

export const MOBILE_NAV_SECTIONS: NavSection[] = [
  {
    label: PRIMARY_SECTION_LABEL,
    items: PRIMARY_NAV_ITEMS,
  },
  { label: UTILITY_SECTION_LABEL, items: OVERFLOW_NAV_ITEMS },
];

export const ALL_NAV_ITEMS = [
  ...PRIMARY_NAV_ITEMS,
  ...OVERFLOW_NAV_ITEMS,
];
