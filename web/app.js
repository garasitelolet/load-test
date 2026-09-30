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
const title = document.querySelector('#run-title');
const description = document.querySelector('#profile-description');
const resultTitle = document.querySelector('#result-title');
const resultState = document.querySelector('#result-state');
const metrics = document.querySelector('#metrics');
const chartWrap = document.querySelector('#chart-wrap');
const chart = document.querySelector('#latency-chart');
const downloadReport = document.querySelector('#download-report');
const output = document.querySelector('#output');
const clock = document.querySelector('#clock');
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
  title.textContent = profile.label;
  description.textContent = profile.description;
  modeBadge.textContent = key.toUpperCase();
  renderProfiles();
  resultTitle.textContent = 'Waiting for a run';
  resultState.hidden = false;
  metrics.hidden = true;
  chartWrap.hidden = true;
  downloadReport.hidden = true;
  output.hidden = true;
}

function setRunning(running) {
  runButton.disabled = running;
  stopButton.disabled = !running;
  modeBadge.textContent = running ? 'RUNNING' : selected.toUpperCase();
  livePill.textContent = running ? 'LIVE' : 'IDLE';
  document.body.classList.toggle('is-running', running);
}

function formatMetric(value, suffix = ' ms') {
  return Number.isFinite(value) ? `${Math.round(value)}${suffix}` : '—';
}

function drawChart(points) {
  const width = chart.clientWidth || 280;
  const height = 150;
  const scale = window.devicePixelRatio || 1;
  chart.width = width * scale;
  chart.height = height * scale;
  const context = chart.getContext('2d');
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#aac7ef';
  context.lineWidth = 1;
  for (let y = 20; y < height; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  if (points.length < 2) return;
  const values = points.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  context.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - 14 - ((point.value - min) / range) * (height - 30);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = '#2769e8';
  context.lineWidth = 2;
  context.stroke();
}

function showSummary(run) {
  const values = run.summary?.metrics || {};
  const duration = values.http_req_duration?.values || {};
  const failed = values.http_req_failed?.values?.rate;
  document.querySelector('#metric-p95').textContent = formatMetric(duration['p(95)']);
  document.querySelector('#metric-p99').textContent = formatMetric(duration['p(99)']);
  document.querySelector('#metric-rate').textContent = values.http_reqs?.values?.rate ? `${values.http_reqs.values.rate.toFixed(1)} req/s` : '—';
  document.querySelector('#metric-failed').textContent = Number.isFinite(failed) ? `${(failed * 100).toFixed(2)}%` : '—';
  metrics.hidden = false;
  chartWrap.hidden = false;
  drawChart(run.report?.series?.latency || []);
  if (run.reportUrl) {
    downloadReport.href = run.reportUrl;
    downloadReport.hidden = false;
  }
  output.textContent = run.error || run.output || 'Run completed without console output.';
  output.hidden = false;
  resultTitle.textContent = run.status === 'completed' ? 'Run completed' : 'Run failed';
  resultState.hidden = true;
  livePill.textContent = run.status === 'completed' ? 'PASS' : 'FAIL';
  livePill.className = `live-pill ${run.status === 'completed' ? 'success' : 'danger'}`;
}

async function pollStatus() {
  if (!activeRunId) return;
  const response = await fetch(`/api/status?id=${activeRunId}`);
  const run = await response.json();
  if (run.status === 'running') {
    resultTitle.textContent = 'Test is running';
    resultState.querySelector('p').textContent = 'k6 is applying pressure. Keep this tab open for the final summary.';
    pollTimer = setTimeout(pollStatus, 1000);
    return;
  }
  clearTimeout(pollTimer);
  setRunning(false);
  showSummary(run);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  values.testType = selected;
  setRunning(true);
  resultTitle.textContent = 'Starting test';
  resultState.hidden = false;
  metrics.hidden = true;
  chartWrap.hidden = true;
  downloadReport.hidden = true;
  output.hidden = true;
  try {
    const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to start test.');
    activeRunId = data.runId;
    pollStatus();
  } catch (error) {
    setRunning(false);
    livePill.textContent = 'ERROR';
    livePill.className = 'live-pill danger';
    resultTitle.textContent = 'Could not start';
    resultState.querySelector('p').textContent = error.message;
  }
});

stopButton.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
});

setInterval(() => { clock.textContent = new Date().toLocaleTimeString('en-GB'); }, 1000);
selectProfile('load');
