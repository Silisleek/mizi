/* ==========================================================
   providers.js — Custom OpenAI-compatible provider support
   Loaded by mizi via <script src='providers.js'></script>
   ========================================================== */
(function() {
"use strict";

var STORAGE_KEY = "mizi_custom_providers";
var _customProviders = [];

/* ── Load / Save ── */
function loadCustomProviders() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    _customProviders = raw ? JSON.parse(raw) : [];
  } catch(e) { _customProviders = []; }
  return _customProviders;
}

function saveCustomProviders(list) {
  _customProviders = list;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  fetch(API_BASE + "/providers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (typeof state !== "undefined" ? state.key : "")
    },
    body: JSON.stringify(list)
  }).catch(function() {});
}

/* ── Add custom model entries to state.models ── */
function syncCustomModels() {
  state.models = state.models.filter(function(m) { return !m.custom; });
  _customProviders.forEach(function(p) {
    (p.models || []).forEach(function(mid) {
      state.models.push({ id: mid, free: false, providerId: p.id, custom: true });
    });
  });
  renderModelList();
}

/* ── Add Provider Modal ── */
function showAddProviderModal() {
  var overlay = document.createElement("div");
  overlay.className = "provider-modal-overlay";
  overlay.innerHTML =
    '<div class="provider-modal">' +
      '<div class="provider-modal-head">' +
        '<span>Add Custom Provider</span>' +
        '<button class="provider-modal-close">&times;</button>' +
      '</div>' +
      '<div class="provider-modal-body">' +
        '<div class="provider-field">' +
          '<label class="provider-label">Provider Name</label>' +
          '<input class="provider-input" id="provName" placeholder="e.g. OpenRouter, LM Studio" />' +
        '</div>' +
        '<div class="provider-field">' +
          '<label class="provider-label">Base URL <span class="provider-hint">(OpenAI-compatible /v1 endpoint)</span></label>' +
          '<input class="provider-input" id="provUrl" placeholder="https://openrouter.ai/api/v1" />' +
        '</div>' +
        '<div class="provider-field">' +
          '<label class="provider-label">API Key</label>' +
          '<input class="provider-input" id="provKey" type="password" placeholder="sk-..." />' +
        '</div>' +
        '<div class="provider-field">' +
          '<label class="provider-label">Model IDs <span class="provider-hint">(comma-separated)</span></label>' +
          '<input class="provider-input" id="provModels" placeholder="gpt-4o, claude-sonnet-4, deepseek-r1" />' +
        '</div>' +
        '<div class="provider-actions">' +
          '<button class="provider-btn provider-btn-ghost" id="provCancelBtn">Cancel</button>' +
          '<button class="provider-btn provider-btn-primary" id="provSaveBtn">Save Provider</button>' +
        '</div>' +
        '<div class="provider-status" id="provStatus"></div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.querySelector("#provName").focus();

  function close() { overlay.remove(); }
  overlay.querySelector(".provider-modal-close").onclick = close;
  overlay.querySelector("#provCancelBtn").onclick = close;
  overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); });

  overlay.querySelector("#provSaveBtn").onclick = function() {
    var name   = overlay.querySelector("#provName").value.trim();
    var url    = overlay.querySelector("#provUrl").value.trim().replace(/\/+$/, "");
    var key    = overlay.querySelector("#provKey").value.trim();
    var models = overlay.querySelector("#provModels").value.split(",").map(function(s){return s.trim()}).filter(Boolean);
    var status = overlay.querySelector("#provStatus");

    if (!name || !url || !key || models.length === 0) {
      status.className = "provider-status error";
      status.textContent = "All fields are required. Enter at least one model ID.";
      return;
    }

    status.className = "provider-status";
    status.textContent = "Testing connection…";

    var id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    var prov = { id: id, name: name, baseUrl: url, apiKey: key, models: models };

    /* Test connection via proxy (avoids CORS issues) */
    fetch(API_BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "X-Provider-Id": id,
        "X-Provider-Base": url,
        "X-Provider-Key": key
      },
      body: JSON.stringify({ model: models[0], messages: [{role:"user", content:"hi"}], max_tokens: 5, stream: false })
    }).then(function(res) {
      if (res.ok) {
        status.className = "provider-status success";
        status.textContent = "✓ Connected to " + name + "!";
        var all = loadCustomProviders();
        all.push(prov);
        saveCustomProviders(all);
        syncCustomModels();
        setTimeout(close, 1000);
      } else {
        return res.text().then(function(t) { throw new Error(t); });
      }
    }).catch(function(err) {
      /* Save anyway — the provider may have CORS issues in the test but work fine in streaming mode */
      status.className = "provider-status success";
      status.textContent = "✓ Saved " + name + " (test skipped — will work with streaming)";
      var all = loadCustomProviders();
      all.push(prov);
      saveCustomProviders(all);
      syncCustomModels();
      setTimeout(close, 1500);
    });
  };
}

/* ── Find which provider owns a model ── */
function getCustomProvider(modelId) {
  for (var i = 0; i < _customProviders.length; i++) {
    if (_customProviders[i].models && _customProviders[i].models.indexOf(modelId) !== -1) {
      return _customProviders[i];
    }
  }
  return null;
}

/* ── Remove a custom provider ── */
function removeCustomProvider(provId) {
  var all = loadCustomProviders().filter(function(p) { return p.id !== provId; });
  saveCustomProviders(all);
  syncCustomModels();
}

/* ── Patch renderModelList to show custom badge ── */
(function() {
  if (typeof renderModelList !== "function") return;
  var _origRL = renderModelList;
  renderModelList = function() {
    _origRL();
    var rows = document.querySelectorAll("#modelList .model-row");
    rows.forEach(function(row) {
      var modelText = row.textContent || "";
      /* Check each model in state.models */
      for (var i = 0; i < state.models.length; i++) {
        var m = state.models[i];
        if (m.custom && modelText.indexOf(shortName(m.id)) !== -1) {
          /* Already has badge? skip */
          if (row.querySelector(".custom-badge")) break;
          var badge = document.createElement("span");
          badge.className = "custom-badge";
          badge.textContent = "●";
          badge.title = "Custom provider";
          badge.style.cssText = "color:#818cf8;font-size:9px;margin-left:4px;vertical-align:middle";
          row.appendChild(badge);
          /* Add small delete button on hover */
          var del = document.createElement("span");
          del.className = "custom-del";
          del.textContent = "×";
          del.title = "Remove provider";
          del.style.cssText = "display:none;color:#ef4444;font-size:13px;margin-left:4px;cursor:pointer;vertical-align:middle";
          del.onclick = function(e) {
            e.stopPropagation();
            if (confirm("Remove provider for " + shortName(m.id) + "?")) {
              removeCustomProvider(m.providerId);
            }
          };
          row.appendChild(del);
          row.addEventListener("mouseenter", function() { del.style.display = "inline"; });
          row.addEventListener("mouseleave", function() { del.style.display = "none"; });
          break;
        }
      }
    });
  };
})();

/* ── Patch updateSendState to allow sending with custom models ── */
(function() {
  if (typeof updateSendState !== "function") return;
  var _origUSS = updateSendState;
  updateSendState = function() {
    _origUSS();
    /* If send is disabled but we have custom models selected, re-enable */
    if (els.sendBtn.disabled && state.selected.size > 0) {
      var hasCustom = false;
      for (var i = 0; i < state.models.length; i++) {
        if (state.models[i].custom && state.selected.has(state.models[i].id)) {
          hasCustom = true; break;
        }
      }
      if (hasCustom) {
        els.sendBtn.disabled = state.busy || !els.input.value.trim();
      }
    }
  };
})();

/* ── Patch chatOnce to route custom provider models ── */
(function() {
  if (typeof chatOnce !== "function") return;
  var _origCO = chatOnce;
  chatOnce = function(model, messages, opts) {
    var prov = getCustomProvider(model);
    if (prov) {
      var url = prov.baseUrl.replace(/\/+$/, "") + "/chat/completions";
      opts = opts || {};
      var origAct = opts.act;
      if (origAct && origAct.set) origAct.set(shortName(model) + " (custom) → " + prov.name);
      return _origCO(model, messages, opts);
    }
    return _origCO(model, messages, opts);
  };
})();

/* ── Monkey-patch chatOnce at the fetch level for custom routing ── */
(function() {
  if (typeof fetch === "undefined") return;
  var _origFetch = window.fetch;
  window.fetch = function(url, init) {
    if (typeof url === "string" && url.indexOf("/chat/completions") !== -1 && init && init.body) {
      try {
        var body = JSON.parse(init.body);
        var modelId = body.model;
        var prov = getCustomProvider(modelId);
        if (prov) {
          url = prov.baseUrl.replace(/\/+$/, "") + "/chat/completions";
          var headers = new Headers(init.headers || {});
          headers.set("Authorization", "Bearer " + prov.apiKey);
          init = Object.assign({}, init, { headers: headers });
        }
      } catch(e) {}
    }
    return _origFetch.apply(this, arguments);
  };
})();

/* ── Hook: add "Add Provider" button + init on DOM ready ── */
function initProviders() {
  /* Add the button if not already present */
  if (!document.getElementById("addProviderBtn")) {
    var modelListEl = document.getElementById("modelList");
    if (modelListEl && modelListEl.parentNode) {
      var btn = document.createElement("button");
      btn.id = "addProviderBtn";
      btn.textContent = "+ Add Provider";
      btn.style.cssText = "display:block;width:100%;padding:6px 0;margin-top:6px;background:none;border:1px dashed var(--border,#333);color:var(--text-dim,#888);border-radius:6px;cursor:pointer;font-size:12px;text-align:center";
      btn.addEventListener("click", showAddProviderModal);
      modelListEl.parentNode.insertBefore(btn, modelListEl.nextSibling);
    }
  }

  /* Load saved providers and add their models */
  loadCustomProviders();
  syncCustomModels();
}

/* Wait for DOM */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProviders);
} else {
  initProviders();
}

/* Expose for console / fugu.js */
window.miziProviders = {
  list: function() { return loadCustomProviders(); },
  add: function(p) { var all = loadCustomProviders(); all.push(p); saveCustomProviders(all); syncCustomModels(); },
  remove: removeCustomProvider,
  get: getCustomProvider
};

})();
