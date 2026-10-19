(function () {
  "use strict";

  var ALLOWED_HOSTS = [
    "rambulls.dev",
    "atlas.rambulls.dev",
    "orbital.rambulls.dev",
  ];
  var STORAGE_KEY = "rambulls.analytics.choice";
  var BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js";
  var EXPIRY_DAYS = 180;
  var MAX_SAFE_TIMEOUT = 2147483647;
  var CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

  var currentScript = document.currentScript;
  if (!currentScript) return;
  var dataHost = currentScript.getAttribute("data-hostname");
  var token = currentScript.getAttribute("data-token");

  if (!dataHost || !token) return;
  if (ALLOWED_HOSTS.indexOf(dataHost) === -1) return;
  if (
    window.location.protocol !== "https:" ||
    window.location.hostname !== dataHost
  )
    return;
  if (!/^[a-f0-9]{32}$/i.test(token)) return;

  var state = {
    started: false,
    cspRestricted: false,
    memChoice: null,
    expiryTimer: null,
  };

  function hasPrivacySignal() {
    if (navigator.globalPrivacyControl === true) return true;
    return [
      navigator.doNotTrack,
      window.doNotTrack,
      navigator.msDoNotTrack,
    ].some(function (value) {
      return value === "1" || value === "yes";
    });
  }

  function getStoredRecord() {
    var data = state.memChoice;
    if (!data) {
      try {
        data = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        return null;
      }
    }
    var now = Date.now();
    if (
      !data ||
      Object.keys(data).sort().join(",") !== "choice,expiresAt,version" ||
      data.version !== 1 ||
      (data.choice !== "allow" && data.choice !== "deny") ||
      typeof data.expiresAt !== "number" ||
      !isFinite(data.expiresAt) ||
      data.expiresAt <= now ||
      data.expiresAt > now + EXPIRY_DAYS * 86400000 + CLOCK_TOLERANCE_MS
    )
      return null;
    return data;
  }

  function getStoredChoice() {
    var record = getStoredRecord();
    return record ? record.choice : null;
  }

  function saveChoice(choice) {
    var payload = {
      version: 1,
      choice: choice,
      expiresAt: Date.now() + EXPIRY_DAYS * 86400000,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      state.memChoice = null;
    } catch {
      state.memChoice = payload;
    }
    scheduleExpiry(payload.expiresAt);
  }

  function scheduleExpiry(expiresAt) {
    clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
    if (expiresAt)
      state.expiryTimer = setTimeout(
        evaluateState,
        Math.max(1, Math.min(MAX_SAFE_TIMEOUT, expiresAt - Date.now())),
      );
  }

  function restrictNetworkCSP() {
    if (state.cspRestricted) return;
    var meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "connect-src 'self'";
    document.head.appendChild(meta);
    state.cspRestricted = true;
    var sdk = document.getElementById("rb-cf-beacon");
    if (sdk && sdk.parentNode) {
      sdk.parentNode.removeChild(sdk);
    }
  }

  function loadCloudflareBeacon() {
    if (state.started || state.cspRestricted) return;
    state.started = true;
    var script = document.createElement("script");
    script.id = "rb-cf-beacon";
    script.type = "module";
    script.src = BEACON_URL;
    script.setAttribute(
      "data-cf-beacon",
      JSON.stringify({ token: token, spa: false }),
    );
    script.onerror = function () {
      var statusEl = document.getElementById("rb-analytics-status");
      if (statusEl) {
        statusEl.textContent =
          "Analytics is unavailable. You can keep using the site.";
      }
    };
    document.head.appendChild(script);
  }

  var ui = {
    banner: null,
    panel: null,
    toggleBtn: null,
    statusMsg: null,
  };

  function createDOM() {
    if (document.getElementById("rb-analytics-root")) return;

    var root = document.createElement("div");
    root.id = "rb-analytics-root";
    root.className = "rb-analytics-root";

    var banner = document.createElement("section");
    banner.id = "rb-analytics-banner";
    banner.className = "rb-analytics-banner rb-analytics-hidden";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Optional analytics");

    var bannerText = document.createElement("p");
    bannerText.className = "rb-analytics-text";
    bannerText.textContent =
      "With your permission, Cloudflare measures page visits and loading speed. Declining won\u2019t affect this site.";

    var noticeLink = document.createElement("a");
    noticeLink.className = "rb-analytics-link";
    noticeLink.href = "https://rambulls.dev/privacy/";
    noticeLink.textContent = " Privacy notice";
    noticeLink.target = "_blank";
    noticeLink.rel = "noopener noreferrer";
    bannerText.appendChild(noticeLink);

    var bannerActions = document.createElement("div");
    bannerActions.className = "rb-analytics-actions";

    var btnAllow = document.createElement("button");
    btnAllow.type = "button";
    btnAllow.className = "rb-analytics-btn rb-analytics-btn-primary";
    btnAllow.textContent = "Allow analytics";
    btnAllow.onclick = function () {
      onUserChoice("allow");
    };

    var btnDecline = document.createElement("button");
    btnDecline.type = "button";
    btnDecline.className = "rb-analytics-btn rb-analytics-btn-secondary";
    btnDecline.textContent = "Decline";
    btnDecline.onclick = function () {
      onUserChoice("deny");
    };

    bannerActions.appendChild(btnAllow);
    bannerActions.appendChild(btnDecline);
    banner.appendChild(bannerText);
    banner.appendChild(bannerActions);

    var panel = document.createElement("div");
    panel.id = "rb-analytics-panel";
    panel.className = "rb-analytics-panel rb-analytics-hidden";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Analytics settings");

    var panelTitle = document.createElement("h2");
    panelTitle.className = "rb-analytics-panel-title";
    panelTitle.textContent = "Analytics Settings";

    var panelDesc = document.createElement("p");
    panelDesc.id = "rb-analytics-desc";
    panelDesc.className = "rb-analytics-panel-desc";

    var statusMsg = document.createElement("div");
    statusMsg.id = "rb-analytics-status";
    statusMsg.className = "rb-analytics-status";
    statusMsg.setAttribute("aria-live", "polite");

    var panelActions = document.createElement("div");
    panelActions.className = "rb-analytics-panel-actions";

    var panelAllowBtn = document.createElement("button");
    panelAllowBtn.id = "rb-panel-allow";
    panelAllowBtn.type = "button";
    panelAllowBtn.className = "rb-analytics-btn rb-analytics-btn-primary";
    panelAllowBtn.textContent = "Allow analytics";
    panelAllowBtn.onclick = function () {
      onUserChoice("allow");
    };

    var panelDeclineBtn = document.createElement("button");
    panelDeclineBtn.id = "rb-panel-decline";
    panelDeclineBtn.type = "button";
    panelDeclineBtn.className = "rb-analytics-btn rb-analytics-btn-secondary";
    panelDeclineBtn.textContent = "Decline";
    panelDeclineBtn.onclick = function () {
      onUserChoice("deny");
    };

    var panelCloseBtn = document.createElement("button");
    panelCloseBtn.type = "button";
    panelCloseBtn.className = "rb-analytics-btn rb-analytics-btn-close";
    panelCloseBtn.textContent = "Close";
    panelCloseBtn.onclick = closePanel;

    panelActions.appendChild(panelAllowBtn);
    panelActions.appendChild(panelDeclineBtn);
    panelActions.appendChild(panelCloseBtn);

    panel.appendChild(panelTitle);
    panel.appendChild(panelDesc);
    panel.appendChild(noticeLink.cloneNode(true));
    panel.appendChild(statusMsg);
    panel.appendChild(panelActions);

    var toggleBtn = document.createElement("button");
    toggleBtn.id = "rb-analytics-toggle";
    toggleBtn.type = "button";
    toggleBtn.className = "rb-analytics-toggle-btn";
    toggleBtn.textContent = "Analytics settings";
    toggleBtn.setAttribute("aria-haspopup", "dialog");
    toggleBtn.setAttribute("aria-controls", "rb-analytics-panel");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.onclick = togglePanel;

    root.appendChild(banner);
    root.appendChild(panel);
    root.appendChild(toggleBtn);
    document.body.appendChild(root);

    ui.banner = banner;
    ui.panel = panel;
    ui.toggleBtn = toggleBtn;
    ui.statusMsg = statusMsg;

    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        !panel.classList.contains("rb-analytics-hidden")
      ) {
        closePanel();
      }
    });
  }

  function onUserChoice(choice) {
    if (choice === "allow") {
      if (hasPrivacySignal()) {
        if (ui.statusMsg)
          ui.statusMsg.textContent =
            "Privacy signal (Global Privacy Control / Do Not Track) active. Analytics cannot be enabled.";
        return;
      }
      if (state.cspRestricted) {
        saveChoice("allow");
        if (state.memChoice) {
          ui.statusMsg.textContent =
            "Your browser cannot save this choice. Reload, then allow analytics again.";
          return;
        }
        window.location.reload();
        return;
      }
      saveChoice("allow");
      loadCloudflareBeacon();
      if (ui.statusMsg) ui.statusMsg.textContent = "Analytics enabled.";
    } else {
      if (state.started) {
        restrictNetworkCSP();
      }
      saveChoice("deny");
      if (ui.statusMsg)
        ui.statusMsg.textContent =
          "Analytics declined. Future connections restricted.";
    }
    if (ui.banner) ui.banner.classList.add("rb-analytics-hidden");
    updateUI();
  }

  function togglePanel() {
    if (!ui.panel) return;
    var isHidden = ui.panel.classList.contains("rb-analytics-hidden");
    if (isHidden) {
      ui.panel.classList.remove("rb-analytics-hidden");
      ui.toggleBtn.setAttribute("aria-expanded", "true");
      updateUI();
      var firstAction = ui.panel.querySelector("button");
      if (firstAction) firstAction.focus();
    } else {
      closePanel();
    }
  }

  function closePanel() {
    if (!ui.panel) return;
    ui.panel.classList.add("rb-analytics-hidden");
    ui.toggleBtn.setAttribute("aria-expanded", "false");
    updateUI();
    if (ui.toggleBtn) ui.toggleBtn.focus();
  }

  function updateUI() {
    var privacy = hasPrivacySignal();
    var choice = getStoredChoice();
    var desc = document.getElementById("rb-analytics-desc");
    var btnAllow = document.getElementById("rb-panel-allow");

    if (privacy) {
      if (desc)
        desc.textContent =
          "A browser privacy signal (GPC/DNT) is enabled. Analytics is strictly disabled.";
      if (btnAllow) btnAllow.disabled = true;
    } else {
      if (btnAllow) btnAllow.disabled = false;
      if (desc) {
        if (choice === "allow") {
          desc.textContent = state.cspRestricted
            ? "Analytics is restricted for this page session."
            : "Analytics is currently enabled.";
        } else if (choice === "deny") {
          desc.textContent = "Analytics is currently declined.";
        } else {
          desc.textContent = "No selection made yet.";
        }
      }
    }

    if (btnAllow)
      btnAllow.textContent = state.cspRestricted
        ? "Allow analytics and reload"
        : "Allow analytics";
    var showBanner =
      !choice && !privacy && ui.panel.classList.contains("rb-analytics-hidden");
    var toggleParent = showBanner ? ui.banner : ui.banner.parentNode;
    if (ui.toggleBtn.parentNode !== toggleParent)
      toggleParent.appendChild(ui.toggleBtn);
    if (showBanner) {
      if (ui.banner) ui.banner.classList.remove("rb-analytics-hidden");
    } else {
      if (ui.banner) ui.banner.classList.add("rb-analytics-hidden");
    }
  }

  function evaluateState() {
    var record = getStoredRecord();
    var allow = !hasPrivacySignal() && record && record.choice === "allow";
    if (allow) {
      if (!state.started && !state.cspRestricted) loadCloudflareBeacon();
    } else if (state.started) restrictNetworkCSP();
    scheduleExpiry(record && record.expiresAt);
    updateUI();
  }

  function init() {
    if (document.getElementById("rb-analytics-root")) return;
    createDOM();
    evaluateState();

    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY || e.key === null) {
        state.memChoice = null;
        evaluateState();
      }
    });

    window.addEventListener("pageshow", evaluateState);
    window.addEventListener("focus", evaluateState);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        evaluateState();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
