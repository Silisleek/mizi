// build.js — Complete Fugu-Ultra + Providers build for mizi
var fs = require("fs");
var BACKUP = "C:/Users/Akshan sharma/Desktop/mizi-complete/mizi.html.bak";
var FILE = "C:/Users/Akshan sharma/Desktop/mizi-complete/mizi.html";
var c = fs.readFileSync(BACKUP, "utf8");
var origLen = c.length;

/* ═══ 0. Fix pre-existing bug: add el: c to trace.call() return ═══ */
var callReturn = c.indexOf("call(title, model, icon)");
if (callReturn !== -1) {
  var chunk = c.substring(callReturn, callReturn + 500);
  var returnIdx = chunk.indexOf("return {");
  if (returnIdx !== -1 && chunk.indexOf("el: c") === -1) {
    var absPos = callReturn + returnIdx + 8; // after "return {"
    c = c.slice(0, absPos) + "el: c," + c.slice(absPos);
    console.log("0 el:fix OK");
  }
}

/* ═══ 1. Server-side: static file serving + run_code endpoint ═══ */
var cbIdx = c.indexOf("http.createServer((req, res) => {");
var insPt = cbIdx + "http.createServer((req, res) => {".length;
var serverCode = [
  "",
  "  /* Fugu-Ultra: static file serving */",
  '  if (req.method === "GET" && req.url === "/fugu.js") {',
  "    try {",
  '      const fs2 = require("fs"), path2 = require("path");',
  '      const p = path2.join(path2.dirname(process.argv[1] || "."), "fugu.js");',
  '      res.writeHead(200, {"content-type":"application/javascript"});',
  '      res.end(fs2.readFileSync(p, "utf8"));',
  '    } catch(e) { res.writeHead(404); res.end("not found"); }',
  "    return;",
  "  }",
  "  /* Fugu-Ultra: run_code endpoint */",
  '  if (req.method === "POST" && req.url === "/api/run_code") {',
  "    const body = [];",
  '    req.on("data", c => body.push(c));',
  '    req.on("end", () => {',
  "      try {",
  '        const { code, language } = JSON.parse(Buffer.concat(body).toString());',
  '        const fs2 = require("fs"), path2 = require("path"), { execSync } = require("child_process");',
  '        const tmpFile = path2.join(require("os").tmpdir(), "mizi_" + Date.now() + (language === "python" ? ".py" : ".js"));',
  '        fs2.writeFileSync(tmpFile, code || "", "utf8");',
  '        let stdout = "", stderr = "", exitCode = 1;',
  '        try { stdout = execSync((language === "python" ? "python " : "node ") + tmpFile, { timeout: 30000, encoding: "utf8", stdio: ["pipe","pipe","pipe"] }); exitCode = 0; }',
  '        catch (e) { stdout = e.stdout || ""; stderr = e.stderr || e.message; exitCode = e.status || 1; }',
  "        try { fs2.unlinkSync(tmpFile); } catch(_){}",
  '        res.writeHead(200, {"content-type":"application/json","access-control-allow-origin":"*"});',
  '        res.end(JSON.stringify({ stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 4000), exitCode, success: exitCode === 0 }));',
  '      } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:{message:e.message}})); }',
  "    });",
  "    return;",
  "  }",
  ""
].join("\n");
c = c.slice(0, insPt) + serverCode + c.slice(insPt);
console.log("1 server code OK");

/* ═══ 1b. Server: providers.js static file serving ═══ */
var fuguHandlerEnd = c.indexOf('res.end(fs2.readFileSync(p, "utf8"));');
if (fuguHandlerEnd !== -1) {
  /* The fugu.js handler ends with } catch(e) {...}\n    return;\n  } — find the closing } of the if block */
  var retPos = c.indexOf("return;", fuguHandlerEnd);
  /* The return; is followed by \r\n  } — find the } on the next line */
  var afterReturn = c.indexOf("}", retPos + 7);
  /* Skip past the } and the following whitespace/newline */
  var afterFuguHandler = afterReturn + 1;
  /* Eat trailing whitespace/newline up to the next non-whitespace */
  while (afterFuguHandler < c.length && (c[afterFuguHandler] === "\r" || c[afterFuguHandler] === "\n" || c[afterFuguHandler] === " " || c[afterFuguHandler] === "\t")) {
    afterFuguHandler++;
  }
  var providersServe = [
    "",
    "  /* Custom providers: serve providers.js */",
    '  if (req.method === "GET" && req.url === "/providers.js") {',
    "    try {",
    '      const fs3 = require("fs"), path3 = require("path");',
    '      const p3 = path3.join(path3.dirname(process.argv[1] || "."), "providers.js");',
    '      res.writeHead(200, {"content-type":"application/javascript"});',
    '      res.end(fs3.readFileSync(p3, "utf8"));',
    '    } catch(e) { res.writeHead(404); res.end("not found"); }',
    "    return;",
    "  }",
    ""
  ].join("\n");
  c = c.slice(0, afterFuguHandler) + providersServe + c.slice(afterFuguHandler);
  console.log("1b providers.js serving OK");
}

/* ═══ 1c. Server: providers.json read/write endpoint ═══ */
var runCodeEnd = c.indexOf('res.end(JSON.stringify({error:{message:e.message}})); }');
if (runCodeEnd !== -1) {
  /* Find the run_code handler's closing: } catch(e) {...}\n    });\n    return;\n  } */
  var afterRunCodeCallback = c.indexOf("});", runCodeEnd) + 3;
  var afterRunCodeReturn = c.indexOf("return;", afterRunCodeCallback);
  var afterRunCode = c.indexOf("}", afterRunCodeReturn + 7);
  afterRunCode += 1;
  /* Skip whitespace after the closing brace */
  while (afterRunCode < c.length && (c[afterRunCode] === "\r" || c[afterRunCode] === "\n" || c[afterRunCode] === " " || c[afterRunCode] === "\t")) {
    afterRunCode++;
  }
  var providersEndpoint = [
    "",
    "  /* Custom providers: CRUD endpoint */",
    '  if (req.method === "GET" && req.url === "/api/providers") {',
    '    const _authG = req.headers.authorization || "";',
    '    if (!_authG || _authG === "Bearer ") { res.writeHead(401); res.end("[]"); return; }',
    "    try {",
    '      const fs4 = require("fs"), path4 = require("path");',
    '      const fp4 = path4.join(path4.dirname(process.argv[1] || "."), "custom_providers.json");',
    '      let provs = [];',
    '      try { provs = JSON.parse(fs4.readFileSync(fp4, "utf8")); } catch(_){}',
    '      res.writeHead(200, {"content-type":"application/json","access-control-allow-origin":"*"});',
    '      res.end(JSON.stringify(provs));',
    '    } catch(e) { res.writeHead(200, {"content-type":"application/json"}); res.end("[]"); }',
    "    return;",
    "  }",
    '  if (req.method === "POST" && req.url === "/api/providers") {',
    '    const _authP = req.headers.authorization || "";',
    '    if (!_authP || _authP === "Bearer ") { res.writeHead(401); res.end(JSON.stringify({error:"no key"})); return; }',
    "    const body4 = [];",
    '    req.on("data", c => body4.push(c));',
    '    req.on("end", () => {',
    "      try {",
    '        const provs = JSON.parse(Buffer.concat(body4).toString());',
    '        const fs4 = require("fs"), path4 = require("path");',
    '        const fp4 = path4.join(path4.dirname(process.argv[1] || "."), "custom_providers.json");',
    '        fs4.writeFileSync(fp4, JSON.stringify(provs, null, 2), "utf8");',
    '        res.writeHead(200, {"content-type":"application/json","access-control-allow-origin":"*"});',
    '        res.end(JSON.stringify({ok:true}));',
    '      } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:{message:e.message}})); }',
    "    });",
    "    return;",
    "  }",
    ""
  ].join("\n");
  c = c.slice(0, afterRunCode) + providersEndpoint + c.slice(afterRunCode);
  console.log("1c providers endpoint OK");
}

/* ═══ 1d. Server: dynamic custom-provider proxy routing ═══ */
var zenProxyOld = 'hostname: "opencode.ai", port: 443';
if (c.indexOf(zenProxyOld) !== -1) {
  /* Insert the header-override logic BEFORE the proxy call (not inside the options object) */
  var proxyBlockStart = c.indexOf('const proxy = https.request({', c.indexOf("req.url.startsWith(\"/api/\")"));
  var proxyInsert = [
    "",
    '        /* Dynamic routing for custom providers */',
    '        let _ph = "opencode.ai", _pp = "/zen/v1" + req.url.slice(4), _pa = req.headers.authorization || "";',
    '        const _pxid = req.headers["x-provider-id"];',
    '        const _pxbase = req.headers["x-provider-base"];',
    '        const _pxkey = req.headers["x-provider-key"];',
    '        if (_pxid && _pxbase) {',
    '          try { const _pu = new URL(_pxbase); _ph = _pu.hostname; _pp = _pu.pathname.replace(/\\/$/,"") + req.url.slice(4); } catch(_){}',
    '          if (_pxkey) _pa = "Bearer " + _pxkey;',
    '        } else if (_pxid) {',
    '          try { const fs5 = require("fs"), path5 = require("path");',
    '            const fp5 = path5.join(path5.dirname(process.argv[1] || "."), "custom_providers.json");',
    '            let _pvs = []; try { _pvs = JSON.parse(fs5.readFileSync(fp5, "utf8")); } catch(_){}',
    '            const _pv = _pvs.find(p => p.id === _pxid);',
    '            if (_pv) { const _pu2 = new URL(_pv.baseUrl); _ph = _pu2.hostname; _pp = _pu2.pathname.replace(/\\/$/,"") + req.url.slice(4); if (_pv.apiKey) _pa = "Bearer " + _pv.apiKey; }',
    '          } catch(_){}',
    '        }',
    ""
  ].join("\n");
  c = c.slice(0, proxyBlockStart) + proxyInsert + c.slice(proxyBlockStart);

  /* Now replace the hardcoded hostname, path, and auth */
  c = c.replace('hostname: "opencode.ai"', 'hostname: _ph');
  c = c.replace('path: "/zen/v1" + req.url.slice(4)', 'path: _pp');
  c = c.replace('authorization: req.headers.authorization || ""', 'authorization: _pa');
  console.log("1d dynamic proxy routing OK");
}

/* ═══ 2. Add <script src='fugu.js'> and <script src='providers.js'> inside HTML string ═══ */
var lastHtml = c.lastIndexOf("</html>");
var cr = String.fromCharCode(92);
var rn = cr + "r" + cr + "n";
var tag = "<script src='providers.js'></script>" + rn + "<script src='fugu.js'></script>" + rn;
c = c.slice(0, lastHtml) + tag + c.slice(lastHtml);
console.log("2 script tags OK");

/* ═══ 3. Update normalizeToolText regex ═══ */
var normOld = "say|talk|whisper|chat|ask|assign_task|co_work|complete_task|handoff|spawn_subagent|run_tests|update_answer|plan_ready|start_talk|done";
var normNew = normOld + "|fugu_ultra|run_code|verify_result|conductor_plan";
// Use a unique marker to avoid infinite loop
var marker = "___FUGU_MARKER___";
c = c.split(normOld).join(marker);
c = c.split(marker).join(normNew);
console.log("3 normalizeToolText OK");

/* ═══ 4. Update RT_TOOL_RE (4 instances) ═══ */
var rtOld = "run_tests|update_answer|plan_ready|start_talk|done)";
var rtNew = "run_tests|update_answer|plan_ready|start_talk|done|fugu_ultra|run_code|verify_result|conductor_plan)";
c = c.split(rtOld).join(rtNew);
console.log("4 RT_TOOL_RE OK");

/* ═══ 5. Add xtizi maxVerifyRetries ═══ */
c = c.replace(
  "xtizi:      { max_tokens: 16384, temperature: 0.75, planSteps: 20, workSteps: 30, talkSteps: 15 }",
  "xtizi:      { max_tokens: 16384, temperature: 0.75, planSteps: 20, workSteps: 30, talkSteps: 15, maxVerifyRetries: 3 }"
);
console.log("5 xtizi config OK");

/* ═══ 6. Add provider modal CSS before </style> ═══ */
var modalCss = [
  "",
  ".provider-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center}",
  ".provider-modal{background:var(--bg,#111);border:1px solid var(--border,#333);border-radius:12px;width:420px;max-width:92vw;max-height:85vh;overflow-y:auto;color:var(--text,#eee);font-family:inherit}",
  ".provider-modal-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border,#333);font-weight:600;font-size:15px}",
  ".provider-modal-close{background:none;border:none;color:var(--text-dim,#888);font-size:22px;cursor:pointer;padding:0 4px}",
  ".provider-modal-body{padding:16px 20px 20px}",
  ".provider-field{margin-bottom:14px}",
  ".provider-label{display:block;font-size:12px;color:var(--text-dim,#999);margin-bottom:5px;font-weight:500}",
  ".provider-hint{font-weight:400;color:var(--text-dim,#666)}",
  ".provider-input{width:100%;padding:9px 11px;background:var(--bg-alt,#1a1a1a);border:1px solid var(--border,#333);border-radius:8px;color:var(--text,#eee);font-size:13px;box-sizing:border-box;outline:none;font-family:inherit}",
  ".provider-input:focus{border-color:var(--accent,#818cf8)}",
  ".provider-actions{display:flex;gap:10px;margin-top:18px;justify-content:flex-end}",
  ".provider-btn{padding:8px 18px;border-radius:8px;border:none;font-size:13px;cursor:pointer;font-weight:500;font-family:inherit}",
  ".provider-btn-primary{background:var(--accent,#818cf8);color:#fff}",
  ".provider-btn-ghost{background:none;border:1px solid var(--border,#333);color:var(--text-dim,#999)}",
  ".provider-status{margin-top:12px;font-size:12px;color:var(--text-dim,#888)}",
  ".provider-status.error{color:#f87171}",
  ".provider-status.success{color:#34d399}",
  ""
].join("\\r\\n");
var styleCloseIdx = c.indexOf("</style>");
if (styleCloseIdx !== -1) {
  c = c.slice(0, styleCloseIdx) + modalCss + c.slice(styleCloseIdx);
  console.log("6 modal CSS OK");
}

/* ═══ 7. Update sidebar footer note ═══ */
c = c.replace("Free models only.", "Free models + your providers.");
console.log("7 footer text OK");

fs.writeFileSync(FILE, c, "utf8");
console.log("\nDone. Size:", origLen, "->", c.length, "(+" + (c.length - origLen) + ")");
