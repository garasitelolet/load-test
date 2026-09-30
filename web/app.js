const profiles = {
  load: { label: 'Load test', short: 'Normal traffic', description: 'Measure the expected day-to-day load and establish a trustworthy baseline.' },
  stress: { label: 'Stress test', short: 'Past capacity', description: 'Push beyond the expected load to find where latency and errors start to bend.' },
  spike: { label: 'Spike test', short: 'Sudden surge', description: 'Simulate an abrupt traffic jump and observe recovery after the surge.' },
  soak: { label: 'Soak / endurance', short: 'Long exposure', description: 'Hold a steady load long enough to expose leaks, pool exhaustion, and drift.' },
  volume: { label: 'Volume test', short: 'Large dataset', description: 'Exercise the endpoint with a large data request to reveal payload and query cost.' },
  scalability: { label: 'Scalability test', short: 'Growth curve', description: 'Compare response behavior across increasing load steps.' },
  capacity: { label: 'Capacity test', short: 'Maximum useful load', description: 'Find the highest useful load before your performance thresholds are crossed.' },
  concurrency: { label: 'Concurrency test', short: 'Same moment', description: 'Keep many users active together to expose contention on shared resources.' },
  breakpoint: { label: 'Breakpoint test', short: 'Failure boundary', description: 'Search for the point where the service no longer meets its contract.' }
};

const list = document.querySelector('#profile-list');
const form = document.querySelector('#run-form');
const runButton = document.querySelector('#run-button');
const stopButton = document.querySelector('#stop-button');
const modeBadge = document.querySelector('#mode-badge');
const livePill = document.querySelector('#live-pill');
const resultTitle = document.querySelector('#result-title');
const resultSubtitle = document.querySelector('#result-subtitle');
const chart = document.querySelector('#latency-chart');
const chartEmpty = document.querySelector('#chart-empty');
const chartRange = document.querySelector('#chart-range');
const downloadReport = document.querySelector('#download-report');
const output = document.querySelector('#output');
const clock = document.querySelector('#clock');
const runElapsed = document.querySelector('#run-elapsed');
let selected = 'load';
let activeRunId = null;
let pollTimer = null;

function renderProfiles() {
  list.innerHTML = Object.entries(profiles).map(([key, profile], index) => `
    <button class="profile-item ${key === selected ? 'selected' : ''}" data-profile="${key}" type="button">
      <span class="profile-index">${String(index + 1).padStart(2, '0')}</span>
      <span><strong>${profile.label}</strong><small>${profile.short}</small></span>
      <span class="profile-arrow" aria-hidden="true"></span>
    </button>`).join('');
  list.querySelectorAll('[data-profile]').forEach((button) => button.addEventListener('click', () => selectProfile(button.dataset.profile)));
}

function selectProfile(key) {
  selected = key;
  const profile = profiles[key];
  document.querySelector('#selected-test-label').textContent = profile.label;
  document.querySelector('#profile-description').textContent = profile.description;
  modeBadge.textContent = key.toUpperCase();
  renderProfiles();
}

function setRunning(running) {
  runButton.disabled = running;
  stopButton.disabled = !running;
  modeBadge.textContent = running ? 'RUNNING' : selected.toUpperCase();
  livePill.textContent = running ? 'LIVE' : 'IDLE';
  document.body.classList.toggle('is-running', running);
}

function formatMetric(value, suffix = ' ms') { return Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '—'; }

function drawChart(points) {
  const width = chart.clientWidth || 600;
  const height = chart.clientHeight || 280;
  const scale = window.devicePixelRatio || 1;
  chart.width = width * scale; chart.height = height * scale;
  const context = chart.getContext('2d'); context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, width, height);
  if (points.length < 2) { chartEmpty.hidden = false; return; }
  chartEmpty.hidden = true;
  const values = points.map((point) => point.value); const max = Math.max(...values, 1); const min = Math.min(...values, 0); const range = Math.max(max - min, 1);
  context.beginPath();
  points.forEach((point, index) => { const x = (index / (points.length - 1)) * width; const y = height - 18 - ((point.value - min) / range) * (height - 36); if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
  context.strokeStyle = '#2868e8'; context.lineWidth = 2.5; context.stroke();
  const last = points[points.length - 1]; context.beginPath(); context.arc(width, height - 18 - ((last.value - min) / range) * (height - 36), 4, 0, Math.PI * 2); context.fillStyle = '#2868e8'; context.fill();
  chartRange.textContent = `${points.length} samples · latest ${formatMetric(last.value)}`;
}

function renderTelemetry(run) {
  const live = run.live || {};
  const values = run.summary?.metrics || {};
  const duration = values.http_req_duration?.values || {};
  const failed = values.http_req_failed?.values?.rate;
  const points = run.report?.series?.latency || live.series?.latency || [];
  document.querySelector('#metric-p95').textContent = formatMetric(duration['p(95)'] ?? live.lastLatency);
  document.querySelector('#metric-p99').textContent = formatMetric(duration['p(99)'] ?? live.lastLatency);
  const rate = values.http_reqs?.values?.rate ?? live.requestRate;
  document.querySelector('#metric-rate').textContent = Number.isFinite(rate) ? `${rate.toFixed(1)} req/s` : '—';
  document.querySelector('#metric-failed').textContent = Number.isFinite(failed) ? `${(failed * 100).toFixed(2)}%` : (run.status === 'running' ? 'LIVE' : '—');
  drawChart(points);
  runElapsed.textContent = run.status === 'running' ? `Live · ${live.activeVus ?? 0} active VUs · ${live.sampleCount ?? 0} requests` : `Finished ${new Date(run.finishedAt).toLocaleTimeString('en-GB')}`;
}

function showSummary(run) {
  renderTelemetry(run);
  output.textContent = run.error || run.output || 'Run completed without console output.';
  output.hidden = false;
  resultTitle.textContent = run.status === 'completed' ? 'Run completed' : 'Run failed';
  resultSubtitle.textContent = run.status === 'completed' ? 'Summary and report are ready.' : 'Review the error below and adjust the runner configuration.';
  livePill.textContent = run.status === 'completed' ? 'PASS' : 'FAIL';
  livePill.className = `live-pill ${run.status === 'completed' ? 'success' : 'danger'}`;
  if (run.reportUrl) { downloadReport.href = run.reportUrl; downloadReport.hidden = false; }
}

async function pollStatus() {
  if (!activeRunId) return;
  const response = await fetch(`/api/status?id=${activeRunId}`);
  const run = await response.json();
  renderTelemetry(run);
  if (run.status === 'running') { resultTitle.textContent = 'Test is running'; resultSubtitle.textContent = 'Live k6 telemetry is updating below.'; pollTimer = setTimeout(pollStatus, 800); return; }
  clearTimeout(pollTimer); setRunning(false); showSummary(run);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form)); values.testType = selected;
  setRunning(true); resultTitle.textContent = 'Starting test'; resultSubtitle.textContent = 'Preparing k6 telemetry…'; output.hidden = true; downloadReport.hidden = true;
  try {
    const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to start test.'); activeRunId = data.runId; pollStatus();
  } catch (error) { setRunning(false); livePill.textContent = 'ERROR'; livePill.className = 'live-pill danger'; resultTitle.textContent = 'Could not start'; resultSubtitle.textContent = error.message; }
});

stopButton.addEventListener('click', async () => { await fetch('/api/stop', { method: 'POST' }); });
setInterval(() => { clock.textContent = new Date().toLocaleTimeString('en-GB'); }, 1000);
selectProfile('load');
