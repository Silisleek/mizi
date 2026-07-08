/* ═══════════════════════════════════════════════════════════════
   FUGU-ULTRA for mizi — loaded via <script src='fugu.js'>
   Multi-model Conductor + TRINITY orchestrator with PARALLEL
   subagent execution. Up to 100 concurrent subagents.
   ═══════════════════════════════════════════════════════════════ */

/* ── Conductor prompt: asks for MANY parallelizable subtasks ── */
const FUGU_CONDUCTOR_PROMPT = function(teamNames) {
  return "You are the CONDUCTOR of Fugu-Ultra — a massively parallel multi-model orchestrator.\n" +
    "Available models: " + teamNames + "\n\n" +
    "Your job: decompose the user's request into MANY fine-grained, atomic subtasks.\n" +
    "CRITICAL: Create 8-15 subtasks (not 1-5). More subtasks = more parallelism = faster completion.\n" +
    "Break work into the smallest useful units. Each subtask should be completable by one model in one pass.\n\n" +
    "For EACH subtask, assign:\n" +
    "  - thinker: the model best at strategy for this specific piece\n" +
    "  - worker: the model best at implementing this specific piece\n" +
    "  - verifier: the model best at evaluating this specific piece\n" +
    "  - depends_on: array of task IDs that must complete FIRST (empty = can run in parallel)\n\n" +
    "MAXIMIZE PARALLELISM: Most tasks should have depends_on: [] so they run simultaneously.\n" +
    "Only chain tasks when one truly needs the output of another (e.g. integration needs components built first).\n\n" +
    "Return a JSON plan (NO markdown fences, just raw JSON):\n" +
    '{"objective":"high-level goal","tasks":[{"id":"T1","description":"what to do",\
"thinker":"model-id","worker":"model-id","verifier":"model-id","depends_on":[]}]}';
};

/* ── Role prompts ── */
const FUGU_THINKER_PROMPT = (td, fb) =>
  "You are the THINKER in a Fugu-Ultra TRINITY loop.\nTask: " + td + "\n" +
  (fb ? "VERIFIER FEEDBACK (last attempt failed):\n" + fb + "\nFix the issues described above.\n" : "") +
  "Devise a detailed strategy. Do NOT write code — only plan the approach clearly.";

const FUGU_WORKER_PROMPT = (td, strategy) =>
  "You are the WORKER in a Fugu-Ultra TRINITY loop.\nTask: " + td + "\n" +
  "THINKER STRATEGY:\n" + strategy + "\n\n" +
  "Produce the complete implementation. Wrap code in fenced blocks.";

const FUGU_VERIFIER_PROMPT = (td, wo, er) =>
  "You are the VERIFIER in a Fugu-Ultra TRINITY loop.\nTask: " + td + "\n" +
  "WORKER OUTPUT:\n" + wo + "\n" +
  (er ? "CODE EXECUTION RESULT:\n" + er + "\n" : "") +
  "Evaluate correctness, completeness, and edge cases.\n" +
  "If code was generated, call TOOL:run_code(code) to test it.\n" +
  "Then call TOOL:verify_result(pass or fail, critique).";

/* ── Tool descriptions ── */
const FUGU_TOOL_MSG = "\n\nFUGU-ULTRA TOOLS:\n" +
  "TOOL:fugu_ultra(task) — delegate complex subtask to Fugu-Ultra (Conductor decomposes, parallel Thinker→Worker→Verifier)\n" +
  "TOOL:fugu_ultra_batch(task1 ||| task2 ||| task3) — run MULTIPLE tasks in parallel\n" +
  "TOOL:run_code(code) — execute Python or JavaScript in a sandbox\n" +
  "TOOL:verify_result(pass or fail, critique) — report verification result\n" +
  "TOOL:conductor_plan(json) — decompose task into structured plan with JSON";

/* ═══════════════════════════════════════════════════════════════
   CONCURRENCY LIMITER — prevents API rate limit issues
   ═══════════════════════════════════════════════════════════════ */
var _fuguSemaphores = { running: 0, queue: [], max: 20 };
function fuguAcquire() {
  return new Promise(function(resolve) {
    if (_fuguSemaphores.running < _fuguSemaphores.max) {
      _fuguSemaphores.running++;
      resolve();
    } else {
      _fuguSemaphores.queue.push(resolve);
    }
  });
}
function fuguRelease() {
  if (_fuguSemaphores.queue.length > 0) {
    _fuguSemaphores.queue.shift()();
  } else {
    _fuguSemaphores.running--;
  }
}

/* ═══ Helper: pick model for a role ═══ */
function fuguPickModel(team, roleAssignments, role, taskIdx) {
  if (roleAssignments && roleAssignments[role]) {
    var assigned = roleAssignments[role];
    for (var i = 0; i < team.length; i++) {
      if (team[i] === assigned || shortName(team[i]).toLowerCase() === assigned.toLowerCase()) {
        return team[i];
      }
    }
  }
  var offsets = { thinker: 0, worker: 1, verifier: 2 };
  return team[(taskIdx + (offsets[role] || 0)) % team.length];
}

/* ═══ Helper: execute code in sandbox ═══ */
async function fuguRunCode(code) {
  try {
    var r = await fetch(API_BASE + "/run_code", { method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({ code: code, language: /def |import /.test(code) ? "python" : "javascript" }) });
    var rr = await r.json();
    return (rr.success ? "PASS" : "FAIL(exit " + rr.exitCode + ")") +
      (rr.stdout ? " stdout: " + rr.stdout.slice(0, 300) : "") +
      (rr.stderr ? " stderr: " + rr.stderr.slice(0, 300) : "") + "\n";
  } catch(e) { return "Error: " + e.message + "\n"; }
}

/* ═══ Single TRINITY subagent (one task) ═══ */
async function fuguTrinitySubagent(task, actor, team, ws, userPrompt, trace, card) {
  var maxRetries = (MODES[state.mode] && MODES[state.mode].maxVerifyRetries) || 3;
  var td = task.description || task;
  var tid = task.id || "T" + (++ws.taskSeq);

  var thinkerModel = fuguPickModel(team, task, "thinker", tid.charCodeAt(1) || 0);
  var workerModel  = fuguPickModel(team, task, "worker", tid.charCodeAt(1) || 0);
  var verifierModel = fuguPickModel(team, task, "verifier", tid.charCodeAt(1) || 0);

  var fb = null, lo = "";
  for (var a = 1; a <= maxRetries; a++) {
    await fuguAcquire();
    try {
      /* THINKER */
      var th = await chat(thinkerModel, [
        { role: "system", content: FUGU_THINKER_PROMPT(td, fb) + FUGU_TOOL_MSG },
        { role: "user", content: "Request: " + userPrompt + "\n\nTask: " + td + "\n\nWorkspace: " + workspaceView(ws) }
      ], { phase: "fugu:thinker", maxContinues: 2 });
      trace.toolUse("thinker", thinkerModel, tid + ": " + th.slice(0, 80));

      /* WORKER */
      var wo = await chat(workerModel, [
        { role: "system", content: FUGU_WORKER_PROMPT(td, th) + FUGU_TOOL_MSG },
        { role: "user", content: "Request: " + userPrompt }
      ], { phase: "fugu:worker", maxContinues: 3 });
      lo = wo;
      trace.toolUse("worker", workerModel, tid + ": " + wo.slice(0, 80));

      /* Execute code */
      var er = "";
      var cm = wo.match(/```(?:python|javascript|js)?\n([\s\S]*?)```/g);
      if (cm) for (var ci = 0; ci < cm.length; ci++) {
        var inn = cm[ci].replace(/^```\w*\n/, "").replace(/\n```$/, "");
        if (inn.trim()) {
          er += await fuguRunCode(inn);
          trace.toolUse("run_code", verifierModel, tid + " code executed");
        }
      }

      /* VERIFIER */
      var vr = await chat(verifierModel, [
        { role: "system", content: FUGU_VERIFIER_PROMPT(td, wo, er || null) + FUGU_TOOL_MSG },
        { role: "user", content: "Verify: " + td }
      ], { phase: "fugu:verifier", maxContinues: 1 });

      var vm = vr.match(/verify_result\(([^,]+),\s*([^)]+)\)/i);
      var ok = vm ? vm[1].trim().toLowerCase() === "pass" : false;
      var critique = vm ? vm[2].trim() : vr.slice(0, 200);
      trace.toolUse("verify_result", verifierModel, ok ? tid + " PASSED" : tid + " FAILED");

      if (ok) {
        ws.talkBoard.push(tid + " VERIFIED by " + shortName(verifierModel) + " (attempt " + a + ")");
        return { id: tid, desc: td, output: lo, models: [thinkerModel, workerModel, verifierModel] };
      } else {
        fb = critique;
        ws.talkBoard.push(tid + " attempt " + a + " failed (" + shortName(verifierModel) + "), retrying...");
      }
    } finally { fuguRelease(); }
  }
  ws.talkBoard.push(tid + " FAILED after " + maxRetries + " attempts");
  return { id: tid, desc: td, output: lo, failed: true };
}

/* ═══ Parallel scheduler: dependency-aware DAG execution ═══ */
async function fuguRunParallel(tasks, actor, team, ws, userPrompt, trace, card) {
  /* Build adjacency: taskId → set of dependents */
  var taskMap = {};
  tasks.forEach(function(t) { taskMap[t.id || ("T" + (++ws.taskSeq))] = t; });

  /* Compute in-degree for each task */
  var inDegree = {};
  var dependents = {};
  tasks.forEach(function(t) {
    var id = t.id;
    if (!inDegree[id]) inDegree[id] = 0;
    if (!dependents[id]) dependents[id] = [];
    (t.depends_on || []).forEach(function(dep) {
      inDegree[id] = (inDegree[id] || 0) + 1;
      if (!dependents[dep]) dependents[dep] = [];
      dependents[dep].push(id);
    });
  });

  /* Topological sort via BFS — compute execution layers */
  var layers = [];
  var remaining = tasks.map(function(t) { return t.id; });

  while (remaining.length > 0) {
    /* Find all tasks with in-degree 0 (ready to run) */
    var ready = remaining.filter(function(id) { return inDegree[id] === 0; });
    if (ready.length === 0) {
      /* Circular dependency — break it by taking first task */
      ready = [remaining[0]];
      ws.talkBoard.push("Fugu-Ultra: breaking circular dependency on " + ready[0]);
    }
    layers.push(ready);
    /* Remove from remaining and update in-degree of dependents */
    ready.forEach(function(id) {
      remaining.splice(remaining.indexOf(id), 1);
      (dependents[id] || []).forEach(function(dep) {
        inDegree[dep]--;
      });
    });
  }

  card.update("Conductor: " + tasks.length + " subtasks in " + layers.length + " layers → launching parallel...");

  /* Execute layers */
  var allResults = [];
  var completedOutputs = {}; /* task id → output, for tasks that depend on others */

  for (var li = 0; li < layers.length; li++) {
    var layer = layers[li];
    if (layer.length === 0) continue;

    card.update("Layer " + (li + 1) + "/" + layers.length + " · " + layer.length + " parallel subagents...");

    /* Launch all tasks in this layer simultaneously */
    var layerPromises = layer.map(function(taskId) {
      var task = taskMap[taskId];
      /* Inject dependency outputs into task description if needed */
      var depOutputs = (task.depends_on || []).map(function(dep) {
        return "[Output of " + dep + "]:\n" + (completedOutputs[dep] || "(not available)");
      }).join("\n\n");

      var enrichedTask = Object.assign({}, task, {
        description: task.description + (depOutputs ? "\n\nDEPENDENCY OUTPUTS:\n" + depOutputs : "")
      });

      return fuguTrinitySubagent(enrichedTask, actor, team, ws, userPrompt, trace, card);
    });

    /* Wait for entire layer to complete */
    var layerResults = await Promise.allSettled(layerPromises);

    /* Collect results and store outputs for dependent tasks */
    layerResults.forEach(function(r) {
      if (r.status === "fulfilled" && r.value) {
        allResults.push(r.value);
        completedOutputs[r.value.id] = r.value.output;
        if (r.value.failed) {
          card.update("Layer " + (li + 1) + ": " + r.value.id + " failed");
        }
      } else if (r.status === "rejected") {
        ws.talkBoard.push("Subagent crashed: " + (r.reason ? r.reason.message : "unknown"));
      }
    });
  }

  return allResults;
}

/* ═══ Main orchestrator (global) ═══ */
async function fuguRunUltra(task, actor, team, ws, userPrompt, trace) {
  var card = trace.call("Fugu-Ultra: " + task.slice(0, 60), actor, "brain");

  /* ── Phase 1: CONDUCTOR decomposes into many subtasks ── */
  card.update("Conductor analyzing...");
  var teamNames = team.map(function(m) { return shortName(m); }).join(", ");
  var conductorPrompt = typeof FUGU_CONDUCTOR_PROMPT === "function"
    ? FUGU_CONDUCTOR_PROMPT(teamNames) : FUGU_CONDUCTOR_PROMPT;

  var raw = await chat(actor, [
    { role: "system", content: conductorPrompt + FUGU_TOOL_MSG },
    { role: "user", content: "User request: " + userPrompt + "\n\nTask to decompose: " + task + "\n\nWorkspace: " + workspaceView(ws) }
  ], { phase: "fugu:conductor", maxContinues: 2 });

  var plan;
  try { var m = raw.match(/\{[\s\S]*\}/); plan = JSON.parse(m ? m[0] : raw); }
  catch(e) { plan = { objective: task, tasks: [{ id: "T1", description: task, depends_on: [] }] }; }
  var tasks = plan.tasks || [{ id: "T1", description: task, depends_on: [] }];

  /* Ensure each task has an id */
  tasks.forEach(function(t, i) { if (!t.id) t.id = "T" + (i + 1); });

  var assignInfo = tasks.map(function(t) {
    return t.id + ":" + shortName(t.thinker || "?") + "/" + shortName(t.worker || "?");
  }).join(" ");
  trace.toolUse("conductor_plan", actor, tasks.length + " subtasks · " + assignInfo);

  /* ── Phase 2: PARALLEL TRINITY execution ── */
  var results = await fuguRunParallel(tasks, actor, team, ws, userPrompt, trace, card);

  /* ── Phase 3: Synthesize ── */
  card.ok("Done · " + results.length + " subtask(s) completed");
  card.collapse();
  var summary = results.map(function(r) {
    return "## " + r.id + ": " + r.desc + "\n" + r.output;
  }).join("\n\n") || "Fugu-Ultra done.";
  ws.talkBoard.push("Fugu-Ultra result: " + summary.slice(0, 800));
}

/* ═══ Patch processTurn to detect Fugu-Ultra tools ═══ */
(function() {
  if (typeof processTurn !== "function") { console.warn("Fugu-Ultra: processTurn not found"); return; }
  var _orig = processTurn;
  processTurn = function(model, rawText, trace, ws, mode) {
    var result = _orig(model, rawText, trace, ws, mode);
    var text = rawText;
    var m;

    /* Detect fugu_ultra calls (single or batch) */
    var fuguRe = /TOOL:fugu_ultra\(([^)]*)\)/gi;
    var batchRe = /TOOL:fugu_ultra_batch\(([^)]*)\)/gi;
    var batchTasks = [];

    /* Collect batch tasks */
    while ((m = batchRe.exec(text)) !== null) {
      var batch = m[1].split("|||").map(function(s) { return s.trim().replace(/^['"]|['"]$/g, ""); });
      batchTasks.push.apply(batchTasks, batch);
    }
    /* Collect single tasks */
    while ((m = fuguRe.exec(text)) !== null) {
      if (text.indexOf("fugu_ultra_batch") === -1 || m.index < text.indexOf("fugu_ultra_batch")) {
        batchTasks.push(m[1].replace(/^['"]|['"]$/g, ""));
      }
    }

    /* Launch all collected tasks in parallel */
    if (batchTasks.length > 0) {
      batchTasks.forEach(function(task) {
        fuguRunUltra(task, model, ws.team, ws, text, trace).catch(function(e) {
          ws.talkBoard.push("Fugu-Ultra error: " + e.message);
        });
        trace.toolUse("fugu_ultra", model, "delegating: " + task.slice(0, 80));
      });
    }

    /* Detect run_code calls */
    var runRe = /TOOL:run_code\(([\s\S]*?)\)/gi;
    while ((m = runRe.exec(text)) !== null) {
      var code = m[1].trim();
      fuguRunCode(code).then(function(summary) {
        ws.talkBoard.push("run_code: " + summary);
        trace.toolUse("run_code", model, "executed");
      });
      trace.toolUse("run_code", model, "executing...");
    }

    /* Detect conductor_plan calls */
    var planRe = /TOOL:conductor_plan\(([^)]*)\)/gi;
    while ((m = planRe.exec(text)) !== null) {
      try {
        var plan = JSON.parse(m[1]);
        ws.conductorPlan = plan;
        (plan.tasks || []).forEach(function(t) {
          var id = t.id || ("T" + (++ws.taskSeq));
          ws.taskBoard.push({ id: id, desc: t.description, owners: [ws.team[0]], status: "open", depends_on: t.depends_on || [] });
        });
        result.planReady = true;
        result.planSummary = plan.objective || "";
        trace.toolUse("conductor_plan", model, (plan.tasks || []).length + " tasks decomposed");
      } catch(e) { trace.toolUse("conductor_plan", model, "parse error: " + e.message); }
    }
    return result;
  };
})();

/* ═══ Auto-help: detect when a model needs help and spawn subagents ═══ */
(function() {
  if (typeof processTurn !== "function") return;
  var _orig = processTurn;
  processTurn = function(model, rawText, trace, ws, mode) {
    var result = _orig(model, rawText, trace, ws, mode);
    /* Only auto-help in WORK/TALK phases when model seems stuck */
    if (mode !== "work" && mode !== "talk") return result;

    var distressPatterns = [
      /(?:I can(?:not|'t|t)|I'm not sure|I don't know|failed|error|struggling|help me|need (?:some )?help|assist(?:ance)?|unclear|uncertain)/i,
      /(?:sorry|apologize|unable to|can't complete|can't finish|incomplete)/i
    ];

    var isDistressed = distressPatterns.some(function(p) { return p.test(rawText); });
    var isShort = rawText.length < 200 && mode === "work";

    if (isDistressed || isShort) {
      /* Auto-spawn a Fugu-Ultra subagent to help */
      var autoTask = "Help complete this task based on the current context. The model " +
        shortName(model) + " needs assistance. Context: " + rawText.slice(0, 300);
      fuguRunUltra(autoTask, model, ws.team, ws, rawText, trace).catch(function() {});
      trace.toolUse("fugu_ultra", model, "auto-help triggered");
    }
    return result;
  };
})();

/* ═══ Add maxVerifyRetries to xtizi mode ═══ */
(function() {
  if (typeof MODES !== "undefined" && MODES.xtizi) {
    MODES.xtizi.maxVerifyRetries = 3;
  }
})();

console.log("Fugu-Ultra loaded ✔ (parallel engine, up to 20 concurrent subagents)");
