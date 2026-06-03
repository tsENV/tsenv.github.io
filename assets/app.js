
const DATA_ROOT = "/public/data";
const DEFAULT_SCOPE = { task_mode: "Code", noise: "Low", context: "High", examples: "Three Examples" };

const state = {
  summary: null,
  leaderboard: null,
  envDescriptions: {},
  envData: {},
  submissionDetails: {},
  home: { taskMode: "Code", axis: "NOISE", reveal: false },
  results: {
    scope: { task_mode: "Code", noise: "Low", context: "High", examples: "Three Examples" },
    compare: false,
    comparisonScope: { task_mode: "Direct", noise: "High", context: "High", examples: "Three Examples" },
    sortKey: "score",
    sortDir: "desc"
  },
  env: { taskMode: "Code", axis: "CONTEXT", sampleIndex: {} }
};

const app = document.getElementById("app");

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/index.html") return "/";
  if (pathname.includes(".")) return pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeScope(scope = {}) {
  const rawTask = scope.task_mode ?? scope.taskMode ?? DEFAULT_SCOPE.task_mode;
  const rawNoise = scope.noise ?? DEFAULT_SCOPE.noise;
  const rawContext = scope.context ?? DEFAULT_SCOPE.context;
  const rawExamples = scope.examples ?? DEFAULT_SCOPE.examples;
  return {
    task_mode: titleCase(rawTask),
    noise: titleCase(rawNoise),
    context: typeof rawContext === "boolean" ? (rawContext ? "High" : "None") : titleCase(rawContext),
    examples: typeof rawExamples === "boolean" ? (rawExamples ? "Three Examples" : "None") : titleCase(rawExamples),
  };
}

function canonicalScope() {
  return normalizeScope(state.summary?.canonical_scope || state.leaderboard?.canonical_scope || DEFAULT_SCOPE);
}

function scopeFromSearch(fallback) {
  const params = new URLSearchParams(window.location.search);
  return normalizeScope({
    task_mode: params.get("task_mode") || fallback.task_mode,
    noise: params.get("noise") || fallback.noise,
    context: params.get("context") || fallback.context,
    examples: params.get("examples") || fallback.examples,
  });
}

function scopeSearch(scope) {
  const normalized = normalizeScope(scope);
  const params = new URLSearchParams();
  params.set("task_mode", normalized.task_mode);
  params.set("noise", normalized.noise);
  params.set("context", normalized.context);
  params.set("examples", normalized.examples);
  return params.toString();
}

function replaceScopeSearch() {
  const route = routeInfo();
  if (route.name !== "results" && route.name !== "result-detail") return;
  const next = `${normalizePath(window.location.pathname)}?${scopeSearch(state.results.scope)}`;
  window.history.replaceState({}, "", next);
}

function routeInfo() {
  const path = normalizePath(window.location.pathname);
  if (path === "/") return { name: "home", path };
  if (path === "/results/") return { name: "results", path };
  if (path.startsWith("/results/")) {
    const parts = path.split("/").filter(Boolean);
    return { name: "result-detail", path, submissionId: parts[1] };
  }
  if (path === "/environments/") return { name: "environments", path };
  if (path.startsWith("/environments/")) {
    const parts = path.split("/").filter(Boolean);
    return { name: "environment-detail", path, environmentId: parts[1] };
  }
  if (path === "/get-started/") return { name: "get-started", path };
  if (path === "/authors/") return { name: "authors", path };
  return { name: "not-found", path };
}

function navActive(name) {
  const current = routeInfo().name;
  if (name === "home") return current === "home";
  if (name === "results") return current === "results" || current === "result-detail";
  if (name === "environments") return current === "environments" || current === "environment-detail";
  return current === name;
}

function shell(content) {
  return `
    <header class="site-header">
      <div class="header-inner">
        <a class="wordmark" href="/" data-link>TSENV</a>
        <nav class="nav-links" aria-label="Primary navigation">
          <a href="/" data-link class="${navActive("home") ? "active" : ""}">Home</a>
          <a href="/results/" data-link class="${navActive("results") ? "active" : ""}">Results</a>
          <a href="/environments/" data-link class="${navActive("environments") ? "active" : ""}">Environments</a>
          <a href="/get-started/" data-link class="${navActive("get-started") ? "active" : ""}">Get Started</a>
          <a href="/authors/" data-link class="${navActive("authors") ? "active" : ""}">Authors</a>
          <a class="external" href="https://arxiv.org/" target="_blank" rel="noreferrer">Paper (arXiv)</a>
          <a class="external" href="https://github.com/tsenv/tsENV" target="_blank" rel="noreferrer">Code</a>
        </nav>
      </div>
    </header>
    <main class="main-shell">${content}</main>
  `;
}

function navigate(path) {
  const url = new URL(path, window.location.origin);
  const normalized = normalizePath(url.pathname);
  const next = `${normalized}${url.search}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState({}, "", next);
  }
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function scopeEquals(a, b) {
  const left = normalizeScope(a);
  const right = normalizeScope(b);
  return left.task_mode === right.task_mode && left.noise === right.noise && left.context === right.context && left.examples === right.examples;
}

function scopeLabel(scope) {
  const normalized = normalizeScope(scope);
  return `${normalized.task_mode}, ${normalized.noise} Noise, ${normalized.context} Context, ${normalized.examples}`;
}

function leaderboardRows() {
  if (Array.isArray(state.leaderboard?.rows)) {
    return state.leaderboard.rows.map(row => ({ ...row, scope: normalizeScope(row.scope), submission_id: row.submission_id || row.id }));
  }
  if (Array.isArray(state.leaderboard?.conditions)) {
    return state.leaderboard.conditions.map(row => ({
      rank: row.rank,
      submission_id: row.submission_id || row.id,
      agent: row.agent,
      model: row.model,
      score: row.score,
      date: row.date,
      submitter: row.submitter,
      scope: normalizeScope(row.scope || row.condition),
      complete: true,
      links: row.links || {},
    }));
  }
  return [];
}

function leaderboardFilters() {
  if (state.leaderboard?.filters) return state.leaderboard.filters;
  const rows = leaderboardRows();
  const values = key => [...new Set(rows.map(row => row.scope[key]))].filter(Boolean);
  return {
    task_mode: values("task_mode").length ? values("task_mode") : ["Code", "Direct"],
    noise: values("noise").length ? values("noise") : ["Low", "High"],
    context: values("context").length ? values("context") : ["High", "None"],
    examples: values("examples").length ? values("examples") : ["None", "One Example", "Three Examples"],
  };
}

function scoreForSubmission(submissionId, scope) {
  const row = leaderboardRows().find(r => r.submission_id === submissionId && scopeEquals(r.scope, scope));
  return row ? row.score : null;
}

function formatScore(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return "—";
  return Number(score).toFixed(3);
}

function selectField(prefix, key, value, options) {
  return `
    <div class="field">
      <label for="${prefix}-${key}">${key.replace("_", " ")}</label>
      <select id="${prefix}-${key}" data-action="set-scope" data-prefix="${prefix}" data-key="${key}">
        ${options.map(option => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </div>
  `;
}

function scopeSelectors(prefix, scope) {
  const filters = leaderboardFilters();
  return `
    <div class="selector-grid">
      ${selectField(prefix, "task_mode", scope.task_mode, filters.task_mode)}
      ${selectField(prefix, "noise", scope.noise, filters.noise)}
      ${selectField(prefix, "context", scope.context, filters.context)}
      ${selectField(prefix, "examples", scope.examples, filters.examples)}
    </div>
  `;
}

async function getEnvironmentDescription(environmentId) {
  if (!state.envDescriptions[environmentId]) {
    state.envDescriptions[environmentId] = await loadJson(`${DATA_ROOT}/environments/${environmentId}/description.json`);
  }
  return state.envDescriptions[environmentId];
}

async function getEnvironmentData(environmentId, sampleIndex = 0) {
  const key = `${environmentId}:${sampleIndex}`;
  if (!state.envData[key]) {
    try {
      state.envData[key] = await loadJson(`${DATA_ROOT}/environments/${environmentId}/data_${sampleIndex}.json`);
    } catch (error) {
      if (sampleIndex === 1) {
        state.envData[key] = await loadJson(`${DATA_ROOT}/environments/${environmentId}/data_0.json`);
      } else {
        throw error;
      }
    }
  }
  return state.envData[key];
}

async function getSubmissionDetail(submissionId) {
  if (!state.submissionDetails[submissionId]) {
    state.submissionDetails[submissionId] = await loadJson(`${DATA_ROOT}/submissions/${submissionId}.json`);
  }
  return state.submissionDetails[submissionId];
}

function buildPath(points, xFor, yFor) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point).toFixed(2)},${yFor(point).toFixed(2)}`).join(" ");
}

function renderPlot(data, description, options = {}) {
  const rows = data.rows || [];
  if (!rows.length) return `<div class="plot-wrap"><p class="muted">No sample rows available.</p></div>`;

  const width = 1000;
  const height = 420;
  const margin = { left: 72, right: 32, top: 30, bottom: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const timeValues = rows.map(r => Number(r.time));
  const minT = Math.min(...timeValues);
  const maxT = Math.max(...timeValues);
  const channelDescriptions = description.observed_channels || (description.observedChannels || []).map(item => (
    typeof item === "string" ? { id: item, label: item, unit: "" } : item
  ));
  const channels = channelDescriptions
    .map(ch => ch.id || ch)
    .filter(id => id !== "time" && rows.some(r => typeof r[id] === "number"));
  const limitedChannels = channels.slice(0, 4);
  const classNames = ["primary", "secondary", "tertiary", "secondary"];
  const xFor = row => margin.left + ((Number(row.time) - minT) / (maxT - minT || 1)) * plotWidth;
  const horizontalGrid = [0, 0.25, 0.5, 0.75, 1].map(f => margin.top + f * plotHeight);
  const verticalGrid = [0, 0.25, 0.5, 0.75, 1].map(f => margin.left + f * plotWidth);
  const interventionX = margin.left + ((Number(data.intervention_time) - minT) / (maxT - minT || 1)) * plotWidth;

  const lineSvg = limitedChannels.map((channel, idx) => {
    const values = rows.map(r => Number(r[channel])).filter(v => Number.isFinite(v));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const bandOffset = options.axis === "NOISE" && idx === 0 ? plotHeight * 0.04 : 0;
    const yFor = row => margin.top + (1 - ((Number(row[channel]) - min) / (max - min || 1))) * plotHeight;
    const path = buildPath(rows, xFor, yFor);
    let band = "";
    if (options.axis === "NOISE" && idx === 0) {
      const upper = rows.map((row, i) => `${i === 0 ? "M" : "L"}${xFor(row).toFixed(2)},${(yFor(row) - bandOffset).toFixed(2)}`).join(" ");
      const lower = [...rows].reverse().map((row, i) => `${i === 0 ? "L" : "L"}${xFor(row).toFixed(2)},${(yFor(row) + bandOffset).toFixed(2)}`).join(" ");
      band = `<path class="noise-band" d="${upper} ${lower} Z"></path>`;
    }
    const labelY = 26 + idx * 20;
    const channelMeta = channelDescriptions.find(ch => (ch.id || ch) === channel) || { label: channel, unit: "" };
    return `${band}<path class="plot-line ${classNames[idx] || "secondary"}" d="${path}"></path>
      <text class="plot-label" x="${margin.left + idx * 220}" y="${labelY}">${escapeHtml(channelMeta.label)}${channelMeta.unit ? ` (${escapeHtml(channelMeta.unit)})` : ""}</text>`;
  }).join("");

  return `
    <div class="plot-wrap" role="img" aria-label="Time-series plot with intervention marker">
      <svg class="plot-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"></rect>
        ${horizontalGrid.map(y => `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}"></line>`).join("")}
        ${verticalGrid.map(x => `<line class="plot-grid" x1="${x}" x2="${x}" y1="${margin.top}" y2="${height - margin.bottom}"></line>`).join("")}
        <line class="plot-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
        <line class="plot-axis" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
        <line class="intervention-line" x1="${interventionX}" x2="${interventionX}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
        ${lineSvg}
        <text class="plot-tick" x="${margin.left}" y="${height - 22}">${minT.toFixed(1)}s</text>
        <text class="plot-tick" x="${width - margin.right - 30}" y="${height - 22}">${maxT.toFixed(1)}s</text>
        <text class="plot-tick" x="${interventionX + 8}" y="${margin.top + 18}">intervention t=${escapeHtml(data.intervention_time)}s</text>
        <text class="plot-tick" x="${width / 2 - 18}" y="${height - 22}">time</text>
        <text class="plot-tick" transform="translate(22 ${height / 2 + 42}) rotate(-90)">normalized channels</text>
      </svg>
    </div>
  `;
}

function findPrompt(description, taskMode, axis, examplesLabel = "Three Examples") {
  const taskType = taskMode.toLowerCase();
  const descLevel = axis === "CONTEXT" ? "high" : "none";
  const trainingSamples = axis === "EXAMPLES" || examplesLabel !== "None" ? ">0" : "none";
  const candidates = description.prompt_combinations || [];
  return candidates.find(p => p.task_type === taskType && p.desc_level === descLevel && p.training_samples === trainingSamples)
      || candidates.find(p => p.task_type === taskType && p.training_samples === trainingSamples)
      || candidates.find(p => p.task_type === taskType)
      || candidates[0];
}

function taskControls(prefix, taskMode, axis, sampleControls = "") {
  return `
    <div class="control-stack">
      <div class="control-row">
        <span class="control-label">Task:</span>
        ${["Code", "Direct"].map(mode => `<button class="toggle-button ${mode === taskMode ? "active" : ""}" data-action="set-${prefix}-task" data-value="${mode}">${mode.toUpperCase()}</button>`).join("")}
      </div>
      <div class="control-row">
        <span class="control-label">Axis:</span>
        ${["NOISE", "CONTEXT", "EXAMPLES"].map(item => `<button class="toggle-button ${item === axis ? "active" : ""}" data-action="set-${prefix}-axis" data-value="${item}">${item}</button>`).join("")}
      </div>
      ${sampleControls}
    </div>
  `;
}

async function renderHome() {
  const description = await getEnvironmentDescription("BallDrop");
  const data = await getEnvironmentData("BallDrop", 1);
  const prompt = findPrompt(description, state.home.taskMode, state.home.axis);
  const axisNote = {
    NOISE: "Noise axis selected: the plot shows a light uncertainty band around the primary channel.",
    CONTEXT: "Context axis selected: the prompt includes simulator and channel context.",
    EXAMPLES: "Examples axis selected: the prompt includes compact labeled examples."
  }[state.home.axis];

  const stats = [
    ["3 physical simulators", "BallDrop, BounceBall, MassSlide"],
    ["2 task modes", "Code and Direct"],
    ["3 controllable axes", "noise, context, examples"],
  ];

  const content = `
    <section class="hero">
      <h1>TSENV: Controllable Time-Series Exploration Benchmark</h1>
      <p>A benchmark for evaluating whether tool-using agents can perform evidence-grounded analysis of multivariate time series.</p>
      <p>Tasks are generated from physical simulators with known interventions. Agents must combine textual descriptions, noisy observations, and optional labeled examples to identify what changed, or that no intervention occurred.</p>
    </section>

    <section class="section" aria-labelledby="stats-title">
      <h2 id="stats-title">Benchmark structure</h2>
      <div class="stats-row">
        ${stats.map(([value, meaning]) => `<div class="stat-cell"><span class="stat-value">${value}</span><span class="stat-meaning">${meaning}</span></div>`).join("")}
      </div>
    </section>

    <section class="section" aria-labelledby="example-title">
      <div class="section-header">
        <h2 id="example-title">Example task visual</h2>
        <p class="page-subtitle">A compact BallDrop task with controls for answer interface and benchmark condition axes.</p>
      </div>
      <div class="panel">
        ${taskControls("home", state.home.taskMode, state.home.axis)}
        ${renderPlot(data, description, { axis: state.home.axis })}
        <div class="prompt-panel">
          <p class="small muted">${axisNote}</p>
          <pre>${escapeHtml(prompt.agent_instruction)}</pre>
          <button class="reveal-button" data-action="toggle-reveal">reveal answer</button>
          ${state.home.reveal ? `<div class="reveal-answer"><strong>Correct answer:</strong> ${escapeHtml(data.answer || data.intervention_parameter || "no intervention")} changed at the intervention marker.</div>` : ""}
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="principles-title">
      <div class="section-header">
        <h2 id="principles-title">Design principles</h2>
      </div>
      <div class="feature-list">
        <div class="feature-item"><strong>Physics-grounded generation.</strong><p>Samples are produced by simulators rather than by static datasets, giving reliable intervention labels and controllable task variants.</p></div>
        <div class="feature-item"><strong>Evidence-grounded agent evaluation.</strong><p>Correct answers require inspecting the observed signals; textual context alone is not sufficient.</p></div>
        <div class="feature-item"><strong>Controlled difficulty axes.</strong><p>TSENV varies textual context, observation noise, labeled examples, and answer interface in matched experimental conditions.</p></div>
      </div>
    </section>
    <div class="footer-rule">Public data is loaded from <code>/public/data</code>.</div>
  `;
  app.innerHTML = shell(content);
}

function sortRows(rows) {
  const { sortKey, sortDir } = state.results;
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === "score") { av = Number(av); bv = Number(bv); }
    if (sortKey === "rank") { av = Number(av); bv = Number(bv); }
    if (av < bv) return -1 * direction;
    if (av > bv) return 1 * direction;
    return 0;
  });
}

function renderLeaderboardTable(rows) {
  const sorted = sortRows(rows);
  const headers = [
    ["rank", "rank"],
    ["agent", "agent"],
    ["model", "model"],
    ["score", "score"],
    ["date", "date"],
    ["submitter", "submitter"],
  ];
  const sortMark = key => state.results.sortKey === key ? (state.results.sortDir === "asc" ? " ↑" : " ↓") : "";
  return `
    <div class="table-wrap">
      <table aria-label="TSENV leaderboard">
        <thead><tr>${headers.map(([key, label]) => `<th><button data-action="sort" data-key="${key}">${label}${sortMark(key)}</button></th>`).join("")}</tr></thead>
        <tbody>
          ${sorted.map(row => {
            const comparisonScore = state.results.compare ? scoreForSubmission(row.submission_id, state.results.comparisonScope) : null;
            const scoreHtml = state.results.compare
              ? `<span>${formatScore(row.score)}</span> <span class="score-compare">→ ${formatScore(comparisonScore)}</span>`
              : formatScore(row.score);
            return `<tr class="clickable-row" data-nav="/results/${encodeURIComponent(row.submission_id)}/?${scopeSearch(state.results.scope)}">
              <td>${row.rank ?? ""}</td>
              <td><strong>${escapeHtml(row.agent)}</strong></td>
              <td>${escapeHtml(row.model)}</td>
              <td class="score-cell">${scoreHtml}</td>
              <td>${escapeHtml(row.date)}</td>
              <td>${escapeHtml(row.submitter)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderResultsToolbar() {
  return `
    <div class="toolbar">
      <div>
        <p class="small muted">Selected condition: ${escapeHtml(scopeLabel(state.results.scope))}</p>
        ${scopeSelectors("primary", state.results.scope)}
      </div>
      <div class="compare-area">
        <button class="compare-button ${state.results.compare ? "active" : ""}" data-action="toggle-compare">Compare</button>
      </div>
      ${state.results.compare ? `<div class="compare-selectors"><p class="small muted">Comparison condition: ${escapeHtml(scopeLabel(state.results.comparisonScope))}</p>${scopeSelectors("comparison", state.results.comparisonScope)}</div>` : ""}
    </div>
  `;
}

function renderResults() {
  replaceScopeSearch();
  const rows = leaderboardRows().filter(row => row.complete !== false && scopeEquals(row.scope, state.results.scope));
  const content = `
    <section>
      <h1 class="page-title">Results</h1>
      <p class="page-subtitle">Filter the public leaderboard by task mode and controllable condition axes. The default scope is Code, Low Noise, High Context, Three Examples.</p>
      ${renderResultsToolbar()}
      <p class="small muted">Only entries with five distinct required seeds for each simulator are shown. With three simulators, each displayed public cell covers 15 runs.</p>
      ${renderLeaderboardTable(rows)}
    </section>
  `;
  app.innerHTML = shell(content);
}

function normalizeSubmissionDetail(detail, submissionId) {
  if (Array.isArray(detail.condition_results)) {
    return {
      ...detail,
      condition_results: detail.condition_results.map(item => ({ ...item, scope: normalizeScope(item.scope) })),
      per_seed_results: (detail.per_seed_results || []).map(item => ({ ...item, scope: normalizeScope(item.scope) })),
    };
  }

  const record = detail.record || leaderboardRows().find(row => row.submission_id === submissionId) || {};
  const baseScope = normalizeScope(record.scope || record.condition || state.results.scope);
  const perCondition = (detail.perCondition || []).map(item => ({
    scope: normalizeScope(item.scope || item.condition || baseScope),
    score: item.score ?? item.overall,
    complete: true,
    distinct_seed_count: Array.isArray(item.seedIds) ? item.seedIds.length : Number(String(item.seeds || "0").split("/", 1)[0]) || 0,
    seeds_by_simulator: item.condition?.simulator ? { [item.condition.simulator]: item.seedIds || [] } : {},
  }));
  const links = detail.links || {};
  return {
    submission_id: record.submission_id || record.id || submissionId,
    agent: record.agent || submissionId,
    model: record.model || "",
    date: record.date || "unknown",
    submitter: record.submitter || "",
    canonical_score: record.score ?? record.overall,
    seed_coverage: {
      required_seeds_per_simulator: (detail.coverage?.requiredSeeds || []).length || 5,
      distinct_required_seeds: perCondition[0]?.seeds_by_simulator || {},
      public_cells_complete: detail.coverage?.complete !== false,
    },
    condition_results: perCondition.length ? perCondition : [{
      scope: baseScope,
      score: record.score ?? record.overall,
      complete: true,
      distinct_seed_count: detail.coverage?.evaluationUnits || 0,
      seeds_by_simulator: {},
    }],
    per_seed_results: (detail.seedResults || []).map(item => ({
      scope: baseScope,
      simulator: record.condition?.simulator || baseScope.simulator || "",
      seed: item.seed,
      question_id: item.questionSlug || item.question_id || "",
      score: item.score,
      trajectory_url: item.trajectory || links.trajectories || "#",
      artifact_url: links.artifacts || "#",
    })),
    downloads: {
      trajectory_archive: links.trajectories || "#",
      complete_results_table: links.results || "#",
      benchmark_dataset: "https://huggingface.co/datasets/TommasoBendinelli/tsenv-benchmark",
    },
  };
}

async function renderResultDetail(submissionId) {
  let detail;
  try {
    detail = normalizeSubmissionDetail(await getSubmissionDetail(submissionId), submissionId);
  } catch (error) {
    renderNotFound(`No submission detail JSON exists for “${submissionId}”.`);
    return;
  }
  replaceScopeSearch();
  const activeCondition = detail.condition_results.find(item => scopeEquals(item.scope, state.results.scope));
  const filteredSeeds = detail.per_seed_results.filter(item => scopeEquals(item.scope, state.results.scope));
  const complete = detail.seed_coverage.public_cells_complete;
  const conditionRows = detail.condition_results
    .filter(item => item.scope.task_mode === state.results.scope.task_mode)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const content = `
    <section>
      <div class="detail-header">
        <div class="detail-title">
          <h1 class="page-title">${escapeHtml(detail.agent)}</h1>
          <p class="page-subtitle">Submission detail for ${escapeHtml(detail.model)} under the active leaderboard filter.</p>
        </div>
        <div class="flat-panel">
          <div class="meta-grid">
            <div class="meta-item"><span>agent</span><strong>${escapeHtml(detail.agent)}</strong></div>
            <div class="meta-item"><span>model</span><strong>${escapeHtml(detail.model)}</strong></div>
            <div class="meta-item"><span>date</span><strong>${escapeHtml(detail.date)}</strong></div>
            <div class="meta-item"><span>submitter</span><strong>${escapeHtml(detail.submitter)}</strong></div>
            <div class="meta-item"><span>displayed score</span><strong>${formatScore(activeCondition?.score)}</strong></div>
            <div class="meta-item"><span>scope</span><strong>${escapeHtml(scopeLabel(state.results.scope))}</strong></div>
          </div>
        </div>
      </div>

      ${renderResultsToolbar()}

      <section class="section">
        <div class="section-header">
          <h2>Seed coverage</h2>
          <p>${complete ? `<span class="badge ok">complete public cell</span>` : `<span class="badge warn">incomplete</span>`} All displayed public cells contain exactly five distinct required seeds for each simulator.</p>
        </div>
        <div>${Object.entries(detail.seed_coverage.distinct_required_seeds).map(([sim, seeds]) => `<span class="badge ok">${escapeHtml(sim)}: ${seeds.length} seeds</span>`).join("")}</div>
      </section>

      <section class="section">
        <div class="section-header">
          <h2>Per-condition results</h2>
          <p class="muted">Rows below show condition-level scores for this submission within the selected task mode.</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>task mode</th><th>noise</th><th>context</th><th>examples</th><th>score</th><th>seeds</th></tr></thead>
            <tbody>${conditionRows.map(item => `<tr>
              <td>${escapeHtml(item.scope.task_mode)}</td><td>${escapeHtml(item.scope.noise)}</td><td>${escapeHtml(item.scope.context)}</td><td>${escapeHtml(item.scope.examples)}</td><td class="score-cell">${formatScore(item.score)}</td><td>${item.distinct_seed_count}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <h2>Per-seed results</h2>
          <p class="muted">The active scope expands to one public run for each seed and simulator.</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>simulator</th><th>seed</th><th>question id</th><th>score</th><th>trajectory</th><th>artifact</th></tr></thead>
            <tbody>${filteredSeeds.map(item => `<tr>
              <td>${escapeHtml(item.simulator)}</td><td>${item.seed}</td><td>${escapeHtml(item.question_id)}</td><td class="score-cell">${formatScore(item.score)}</td><td><a href="${item.trajectory_url}" target="_blank" rel="noreferrer">trajectory</a></td><td><a href="${item.artifact_url}" target="_blank" rel="noreferrer">artifact</a></td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>Downloads</h2></div>
        <p><a href="${detail.downloads.trajectory_archive}" target="_blank" rel="noreferrer">Trajectory archive</a> · <a href="${detail.downloads.complete_results_table}" target="_blank" rel="noreferrer">Complete results table</a> · <a href="${detail.downloads.benchmark_dataset}" target="_blank" rel="noreferrer">Benchmark dataset</a></p>
      </section>
    </section>
  `;
  app.innerHTML = shell(content);
}

async function renderEnvironments() {
  const descriptions = await Promise.all(state.summary.simulators.map(id => getEnvironmentDescription(id)));
  const content = `
    <section>
      <h1 class="page-title">Environments</h1>
      <p class="page-subtitle">Each simulator exposes browser-ready metadata, plotted samples, prompt variants, and benchmark download links.</p>
      <div class="card-grid">
        ${descriptions.map(desc => {
          const environmentId = desc.environment_id || desc.sourceName || desc.name;
          return `<a class="env-card" href="/environments/${escapeHtml(environmentId)}/" data-link>
          <div><strong>${escapeHtml(desc.name)}</strong><p>${escapeHtml(desc.short_one_line_description)}</p></div><span>Open environment</span>
        </a>`;
        }).join("")}
      </div>
    </section>
  `;
  app.innerHTML = shell(content);
}

async function renderEnvironmentDetail(environmentId) {
  let description;
  try {
    description = await getEnvironmentDescription(environmentId);
  } catch (error) {
    renderNotFound(`No environment data exists for “${environmentId}”.`);
    return;
  }
  const sampleCount = description.sample_count || 1;
  const selectedSample = state.env.sampleIndex[environmentId] || 1;
  const data = await getEnvironmentData(environmentId, Math.min(selectedSample, sampleCount));
  const prompt = findPrompt(description, state.env.taskMode, state.env.axis);
  const sampleControls = `
    <div class="control-row">
      <span class="control-label">Sample:</span>
      <select data-action="set-env-sample" data-environment="${escapeHtml(environmentId)}">
        ${Array.from({ length: sampleCount }, (_, index) => {
          const sampleNumber = index + 1;
          return `<option value="${sampleNumber}" ${sampleNumber === selectedSample ? "selected" : ""}>${sampleNumber}</option>`;
        }).join("")}
      </select>
    </div>`;
  const content = `
    <section>
      <h1 class="page-title">${escapeHtml(description.name)}</h1>
      <p class="page-subtitle">${escapeHtml(description.short_one_line_description)}</p>
      <div class="panel">
        ${taskControls("env", state.env.taskMode, state.env.axis, sampleControls)}
        ${renderPlot(data, description, { axis: state.env.axis })}
      </div>
      <div class="prompt-panel">
        <h2>Agent prompt</h2>
        <pre>${escapeHtml(prompt.agent_instruction)}</pre>
      </div>
      <section class="section">
        <div class="section-header"><h2>Simulator details</h2></div>
        <div class="meta-grid">
          <div class="meta-item"><span>observed channels</span><strong>${(description.observed_channels || description.observedChannels || []).map(ch => escapeHtml(ch.id || ch)).join(", ")}</strong></div>
          <div class="meta-item"><span>candidate parameters</span><strong>${(description.candidate_parameters || description.candidateParameters || []).map(escapeHtml).join(", ")}</strong></div>
          <div class="meta-item"><span>intervention parameter in current sample</span><strong>${escapeHtml(data.intervention_parameter)}</strong></div>
          <div class="meta-item"><span>download</span><strong><a href="${description.download_link}" target="_blank" rel="noreferrer">question bundle</a></strong></div>
        </div>
      </section>
    </section>
  `;
  app.innerHTML = shell(content);
}

function renderGetStarted() {
  const quickStart = `# Clone and install
git clone <TSENV_PUBLIC_REPOSITORY_URL>
cd tsENV
python -m venv env
source env/bin/activate
pip install -e .

# Launch local explorer to explore the data locally
bash web_model_explorer/start.sh

# Run one agentic evaluation
python workflows/rollout/question_run_orchestrator.py \\
  --tasks-dir tsENV_questions \\
  --model BallDrop \\
  --agent-id <AGENT_ID> \\
  --row-slug <ROW_SLUG>`;

  const bundle = `<submission_id>/
  seed_coverage.json
  <question_id>/
    scores.json
    atif_trajectory.json
    artifact/
      scripts/
      plots/
      logs/
      generated_files/
  <question_id>/
    scores.json
    atif_trajectory.json
    artifact/
      ...`;

  const content = `
    <section>
      <h1 class="page-title">Get Started and Submit</h1>
      <p class="page-subtitle">Run TSENV locally, inspect the data explorer, and submit one structured agent result bundle through GitHub.</p>
      <div class="code-shell">
        <div class="code-shell-header"><span>Run locally</span><button class="copy-button" data-action="copy-code" data-copy-target="quick-start-code">copy</button></div>
        <pre id="quick-start-code" class="code-block">${escapeHtml(quickStart)}</pre>
      </div>

      <section class="section">
        <div class="section-header"><h2>Submit a new result</h2></div>
        <p>To submit a new result, open a GitHub pull request with one structured submission bundle. The bundle should include submission metadata, seed coverage, one folder for each submitted question/run, the corresponding <code>scores.json</code> and <code>atif_trajectory.json</code> files, and the artifacts produced during the run.</p>
        <div class="flow-list">
          <div class="flow-item"><strong>1. Package one submission.</strong><p>Scope the pull request to one agent/submission so validation and publication stay atomic.</p></div>
          <div class="flow-item"><strong>2. Validate and preprocess.</strong><p>The importer checks seed coverage and generates compact public leaderboard records.</p></div>
          <div class="flow-item"><strong>3. Publish canonical data.</strong><p>Accepted bundles are uploaded to Hugging Face, then website JSON is regenerated from that state.</p></div>
        </div>
        <div class="code-shell">
          <div class="code-shell-header"><span>Raw submission bundle schema</span><button class="copy-button" data-action="copy-code" data-copy-target="bundle-code">copy</button></div>
          <pre id="bundle-code" class="code-block">${escapeHtml(bundle)}</pre>
        </div>
      </section>
    </section>
  `;
  app.innerHTML = shell(content);
}

function renderAuthors() {
  const citation = `@inproceedings{tsenv2026,
  title={TSENV: Controllable Time-Series Exploration Benchmark for Agents},
  author={...},
  year={2026}
}`;
  const content = `
    <section>
      <h1 class="page-title">Authors, Citation, and Contact</h1>
      <p class="page-subtitle">Project authorship, citable metadata, and collaboration links.</p>

      <section class="section">
        <div class="section-header"><h2>Authors</h2></div>
        <p><strong>TSENV Team</strong>, ETH Zurich SIPLAB and collaborators.</p>
        <p class="muted">Replace this placeholder with final author names, affiliations, and equal-contribution notes.</p>
      </section>

      <section class="section">
        <div class="section-header"><h2>Citation</h2></div>
        <div class="code-shell dark-code">
          <pre class="code-block">${escapeHtml(citation)}</pre>
        </div>
      </section>

      <section class="section">
        <div class="section-header"><h2>Contact</h2></div>
        <p>Questions, feedback, or collaboration.</p>
        <div class="contact-row">
          <a href="mailto:tsenv@siplab.org">Email</a>
          <a href="https://github.com/tsenv/tsENV" target="_blank" rel="noreferrer">Repository</a>
          <a href="https://siplab.org" target="_blank" rel="noreferrer">Affiliation</a>
        </div>
      </section>
    </section>
  `;
  app.innerHTML = shell(content);
}

function renderNotFound(message = "The requested route is not part of this website.") {
  const content = `
    <section class="error-box">
      <h1 class="page-title">Page not found</h1>
      <p class="page-subtitle">${escapeHtml(message)}</p>
      <p><a href="/" data-link>Return home</a></p>
    </section>
  `;
  app.innerHTML = shell(content);
}

async function render() {
  try {
    const route = routeInfo();
    if (!state.summary || !state.leaderboard) {
      state.summary = await loadJson(`${DATA_ROOT}/summary.json`);
      state.leaderboard = await loadJson(`${DATA_ROOT}/leaderboard.json`);
      state.results.scope = scopeFromSearch(canonicalScope());
    }
    if (route.name === "results" || route.name === "result-detail") {
      state.results.scope = scopeFromSearch(state.results.scope);
    }

    if (route.name === "home") return await renderHome();
    if (route.name === "results") return renderResults();
    if (route.name === "result-detail") return await renderResultDetail(route.submissionId);
    if (route.name === "environments") return await renderEnvironments();
    if (route.name === "environment-detail") return await renderEnvironmentDetail(route.environmentId);
    if (route.name === "get-started") return renderGetStarted();
    if (route.name === "authors") return renderAuthors();
    return renderNotFound();
  } catch (error) {
    console.error(error);
    app.innerHTML = shell(`<section class="error-box"><h1 class="page-title">Load error</h1><p class="page-subtitle">${escapeHtml(error.message)}</p><p class="muted">Serve this directory from the repository root so root-relative assets and data paths resolve correctly.</p></section>`);
  }
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[data-link]");
  if (link) {
    const url = new URL(link.href, window.location.origin);
    if (url.origin === window.location.origin) {
      event.preventDefault();
      navigate(url.pathname);
      return;
    }
  }

  const navRow = event.target.closest("tr[data-nav]");
  if (navRow && !event.target.closest("a, button, select")) {
    navigate(navRow.dataset.nav);
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "set-home-task") {
    state.home.taskMode = button.dataset.value;
    state.home.reveal = false;
    render();
  } else if (action === "set-home-axis") {
    state.home.axis = button.dataset.value;
    state.home.reveal = false;
    render();
  } else if (action === "toggle-reveal") {
    state.home.reveal = !state.home.reveal;
    render();
  } else if (action === "toggle-compare") {
    state.results.compare = !state.results.compare;
    render();
  } else if (action === "sort") {
    const key = button.dataset.key;
    if (state.results.sortKey === key) {
      state.results.sortDir = state.results.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.results.sortKey = key;
      state.results.sortDir = key === "score" || key === "rank" ? "desc" : "asc";
    }
    render();
  } else if (action === "set-env-task") {
    state.env.taskMode = button.dataset.value;
    render();
  } else if (action === "set-env-axis") {
    state.env.axis = button.dataset.value;
    render();
  } else if (action === "copy-code") {
    const target = document.getElementById(button.dataset.copyTarget);
    if (target) {
      navigator.clipboard?.writeText(target.textContent || "");
      button.textContent = "copied";
      setTimeout(() => { button.textContent = "copy"; }, 900);
    }
  }
});

document.addEventListener("change", event => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;

  if (target.dataset.action === "set-scope") {
    const prefix = target.dataset.prefix;
    const key = target.dataset.key;
    if (prefix === "primary") {
      state.results.scope[key] = target.value;
      replaceScopeSearch();
    } else if (prefix === "comparison") {
      state.results.comparisonScope[key] = target.value;
    }
    render();
  } else if (target.dataset.action === "set-env-sample") {
    state.env.sampleIndex[target.dataset.environment] = Number(target.value);
    render();
  }
});

window.addEventListener("popstate", render);
render();
