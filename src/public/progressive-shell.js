/* global document, URL, URLSearchParams, window */

(function () {
  "use strict";

  var CATALOG_NAMES = {
    "cmmc-2": "CMMC 2.0",
    "csf-2": "NIST CSF 2.0",
    "cui-policy": "CUI Program",
    "disa-cci": "DISA CCI",
    "disa-srg": "DISA SRG",
    "disa-stig": "DISA STIG",
    "dod-rai": "DoD AI Assurance",
    "dod-zt": "DoD Zero Trust",
    "fedramp-rev5": "FedRAMP Rev. 5",
    "fips-199": "FIPS 199",
    "fips-200": "FIPS 200",
    "mitre-attack": "MITRE ATT&CK",
    "mitre-attack-ics": "MITRE ATT&CK for ICS",
    "mitre-d3fend": "MITRE D3FEND",
    "nist-800-171": "SP 800-171 Rev. 3",
    "nist-800-171-rev2": "SP 800-171 Rev. 2",
    "nist-800-172": "SP 800-172 Rev. 3",
    "nist-800-37": "SP 800-37 Rev. 2",
    "nist-800-53": "SP 800-53 Rev. 5",
    "nist-800-53a": "SP 800-53A Rev. 5",
    "nist-800-53b": "SP 800-53B",
    "nist-ai-rmf": "AI RMF",
    "nist-ssdf": "SSDF"
  };

  function decode(value) {
    try {
      return decodeURIComponent(value || "");
    } catch {
      return value || "";
    }
  }

  function sharedCopy(key) {
    var node = document.getElementById("control-atlas-copy");
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}")[key] || null;
    } catch {
      return null;
    }
  }

  function routeIdentity() {
    var raw = window.location.hash.replace(/^#/, "") || "/";
    var routeUrl = new URL(raw, window.location.origin);
    var segments = routeUrl.pathname.split("/").filter(Boolean);
    var route = segments[0] || "";
    var query = routeUrl.searchParams;

    if (route === "atlas") {
      var atlasCopy = sharedCopy("atlas") || { eyebrow: "", summary: "Start with a topic and work toward the details.", title: "Atlas" };
      var rawNode = query.get("node") || "";
      var nodeParts = decode(rawNode).split(":");
      var identifier = nodeParts[nodeParts.length - 1] || "";
      return identifier
        ? {
            eyebrow: atlasCopy.eyebrow || "",
            kind: "atlas",
            summary: atlasCopy.summary,
            title: identifier
          }
        : {
            eyebrow: atlasCopy.eyebrow || "",
            kind: "atlas",
            summary: atlasCopy.summary,
            title: atlasCopy.title
          };
    }
    if (route === "library") {
      var libraryCopy = sharedCopy("library") || { eyebrow: "", summary: "Search by identifier, title, or topic.", title: "Library" };
      var catalogId = segments[1] === "publication" ? decode(segments[2] || "") : "";
      return catalogId
        ? {
            eyebrow: libraryCopy.eyebrow || "",
            kind: "catalog",
            summary: libraryCopy.summary,
            title: CATALOG_NAMES[catalogId] || catalogId
          }
        : {
            eyebrow: libraryCopy.eyebrow || "",
            kind: "catalog",
            summary: libraryCopy.summary,
            title: libraryCopy.title
          };
    }
    if (route === "record") {
      var recordCopy = sharedCopy("record") || { eyebrow: "", summary: "Read the published text and record details.", title: "Record" };
      return {
        eyebrow: recordCopy.eyebrow || "",
        kind: "record",
        summary: recordCopy.summary,
        title: decode(segments.slice(2).join("/")) || recordCopy.title
      };
    }
    if (route === "compare") {
      var compareCopy = sharedCopy("compare") || { eyebrow: "", summary: "Compare frameworks and related records.", title: "Compare" };
      return {
        eyebrow: compareCopy.eyebrow || "",
        kind: "compare",
        summary: compareCopy.summary,
        title: compareCopy.title
      };
    }
    if (route === "build") {
      var documentsCopy = sharedCopy("documents") || { eyebrow: "", summary: "Choose what you need to produce.", title: "Documents" };
      return {
        eyebrow: documentsCopy.eyebrow || "",
        kind: "documents",
        summary: documentsCopy.summary,
        title: segments[1] === "tasks" ? "Tasks" : documentsCopy.title
      };
    }
    if (route === "sources") {
      if (query.get("source")) return null;
      var sourcesCopy = sharedCopy("sources") || { eyebrow: "", summary: "Check publication ownership, version, and update status.", title: "Sources" };
      return {
        eyebrow: sourcesCopy.eyebrow || "",
        kind: "sources",
        summary: sourcesCopy.summary,
        title: sourcesCopy.title
      };
    }
    if (route === "start") {
      var startCopy = sharedCopy("start") || { eyebrow: "", summary: "Not sure where to begin? Start here.", title: "Start here" };
      return {
        eyebrow: startCopy.eyebrow || "",
        kind: "start",
        summary: startCopy.summary,
        title: startCopy.title
      };
    }
    if (route === "guides") {
      if (query.get("pattern")) return null;
      var guidesCopy = sharedCopy("guides") || { eyebrow: "", summary: "Follow step-by-step guidance for common federal cybersecurity work.", title: "Guides" };
      return {
        eyebrow: guidesCopy.eyebrow || "",
        kind: "guides",
        summary: guidesCopy.summary,
        title: guidesCopy.title
      };
    }
    if (route === "about") {
      var aboutCopy = sharedCopy("about") || { eyebrow: "", summary: "About Control Atlas.", title: "About" };
      return {
        eyebrow: aboutCopy.eyebrow || "",
        kind: "about",
        summary: aboutCopy.summary,
        title: aboutCopy.title
      };
    }
    return null;
  }

  function isHome() {
    var route = window.location.hash.replace(/^#/, "");
    return route === "" || route === "/" || route.indexOf("/?") === 0;
  }

  function isSearch() {
    return window.location.hash.replace(/^#/, "").indexOf("/library") === 0;
  }

  function setHidden(element, hidden) {
    if (element) element.toggleAttribute("hidden", hidden);
  }

  function remove(element) {
    if (element) element.remove();
  }

  function syncFirstPaintShell() {
    var root = document.getElementById("root");
    if (!root) return;
    var home = isHome();
    var search = isSearch();
    var identity = routeIdentity();
    var shell = root.querySelector("[data-static-route]");

    if (home) {
      remove(root.querySelector("[data-static-route]"));
      remove(root.querySelector("[data-static-search]"));
    } else if (search) {
      remove(root.querySelector("[data-static-home]"));
      remove(root.querySelector("[data-static-route]"));
    } else {
      remove(root.querySelector("[data-static-home]"));
      remove(root.querySelector("[data-static-search]"));
    }

    if (search) root.dataset.staticSearchActive = "true";
    else delete root.dataset.staticSearchActive;

    if (identity && shell && !home && !search) {
      root.dataset.staticRouteActive = "true";
      root.dataset.staticRouteKind = identity.kind;
      var eyebrowNode = shell.querySelector("[data-static-route-eyebrow]");
      if (eyebrowNode) {
        var eyebrowText = (identity.eyebrow || "").trim();
        eyebrowNode.textContent = eyebrowText;
        if (!eyebrowText || eyebrowText.toLowerCase() === (identity.title || "").trim().toLowerCase()) {
          eyebrowNode.hidden = true;
        } else {
          eyebrowNode.removeAttribute("hidden");
        }
      }
      shell.querySelector("[data-static-route-title]").textContent = identity.title;
      shell.querySelector("[data-static-route-summary]").textContent = identity.summary;
      shell.removeAttribute("hidden");
    } else if (shell) {
      setHidden(shell, true);
    }

    if (search) {
      var raw = window.location.hash.replace(/^#/, "");
      var queryIndex = raw.indexOf("?");
      var input = root.querySelector("[data-static-search-input]");
      if (input) {
        input.value = queryIndex === -1
          ? ""
          : new URLSearchParams(raw.slice(queryIndex + 1)).get("q") || "";
      }
    }
  }

  window.controlAtlasProgressiveRouteIdentity = routeIdentity;
  window.controlAtlasSyncFirstPaintShell = syncFirstPaintShell;
  syncFirstPaintShell();
})();
