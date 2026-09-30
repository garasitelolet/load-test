import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';

const root = import.meta.dir;
const port = Number(process.env.PORT || 3000);
const reportsDir = join(root, 'reports');
const runs = new Map<string, Record<string, unknown>>();
let activeProcess: Bun.Subprocess | null = null;

await Bun.write(join(reportsDir, '.gitkeep'), '');

const testProfiles = new Set([
  'load',
  'stress',
  'spike',
  'soak',
  'volume',
  'scalability',
  'capacity',
  'concurrency',
  'breakpoint'
]);

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function createPdfReport(report: Record<string, unknown>) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const summary = (report.summary || {}) as { metrics?: Record<string, { values?: Record<string, number> }> };
    const metrics = summary.metrics || {};
    const duration = metrics.http_req_duration?.values || {};
    const requests = metrics.http_reqs?.values || {};
    const failed = metrics.http_req_failed?.values?.rate;
    const config = (report.config || {}) as Record<string, string | number>;
    const series = ((report.series || {}) as { latency?: Array<{ value: number }> }).latency || [];

    document.fontSize(22).fillColor('#18202a').text('SIMAS / k6 Performance Report');
    document.moveDown(.35).fontSize(10).fillColor('#718091').text(`Generated ${new Date(String(report.finishedAt)).toLocaleString('id-ID')}`);
    document.moveDown(1).fontSize(13).fillColor('#2868e8').text(`${String(report.testType || 'performance').toUpperCase()} TEST`);
    document.moveDown(.5).fontSize(10).fillColor('#18202a').text(`Target: ${String(config.baseUrl || '')}${String(config.path || '')}`);
    document.text(`Duration: ${String(config.duration || '-') } · Target VUs: ${String(config.targetVus || '-') } · Think time: ${String(config.thinkTime || '0')}s`);

    document.moveDown(1).fontSize(12).fillColor('#18202a').text('Performance summary');
    const summaryRows = [
      ['p95 latency', `${Math.round(duration['p(95)'] || 0)} ms`],
      ['p99 latency', `${Math.round(duration['p(99)'] || 0)} ms`],
      ['request rate', `${(requests.rate || 0).toFixed(2)} req/s`],
      ['failed requests', `${((failed || 0) * 100).toFixed(2)}%`]
    ];
    summaryRows.forEach(([label, value]) => document.fontSize(10).fillColor('#718091').text(label, 48, document.y + 8).fillColor('#18202a').text(value, 190, document.y - 10));

    document.moveDown(2).fontSize(12).fillColor('#18202a').text('Latency over time');
    const chartX = 48; const chartY = document.y + 14; const chartWidth = 500; const chartHeight = 180;
    document.rect(chartX, chartY, chartWidth, chartHeight).fillAndStroke('#f5f8fc', '#dce3ea');
    if (series.length > 1) {
      const values = series.map((point) => point.value); const max = Math.max(...values, 1); const min = Math.min(...values, 0); const range = Math.max(max - min, 1);
      document.moveTo(chartX, chartY + chartHeight - 15);
      series.forEach((point, index) => {
        const x = chartX + (index / (series.length - 1)) * chartWidth;
        const y = chartY + chartHeight - 15 - ((point.value - min) / range) * (chartHeight - 30);
        if (index === 0) document.moveTo(x, y); else document.lineTo(x, y);
      });
      document.lineWidth(2).strokeColor('#2868e8').stroke();
      document.fontSize(8).fillColor('#718091').text(`min ${Math.round(min)} ms`, chartX, chartY + chartHeight + 7);
      document.text(`max ${Math.round(max)} ms`, chartX + chartWidth - 70, chartY + chartHeight + 7);
    } else {
      document.fontSize(9).fillColor('#718091').text('No latency series available.', chartX + 12, chartY + chartHeight / 2);
    }
    document.end();
  });
}

async function readLiveSeries(eventsPath: string) {
  const series = { latency: [], vus: [] } as {
    latency: Array<{ time: string; value: number }>;
    vus: Array<{ time: string; value: number }>;
  };
  let requestCount = 0;
  const requestTimes: number[] = [];
  const buckets = new Map<string, { latency?: number; vus?: number }>();
  const eventsFile = Bun.file(eventsPath);
  if (!(await eventsFile.exists())) return { series, sampleCount: 0, lastLatency: undefined, activeVus: 0 };

  for (const line of (await eventsFile.text()).split('\n')) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as { type?: string; metric?: string; data?: { time?: string; value?: number } };
      if (event.type !== 'Point' || !event.data?.time || !Number.isFinite(event.data.value)) continue;
      const bucket = new Date(event.data.time).toISOString().slice(0, 19);
      const current = buckets.get(bucket) || {};
      if (event.metric === 'http_req_duration') {
        requestCount += 1;
        requestTimes.push(new Date(event.data.time).getTime());
        current.latency = event.data.value;
      }
      if (event.metric === 'vus') current.vus = event.data.value;
      buckets.set(bucket, current);
    } catch {
      // Ignore a partial final line while k6 is writing.
    }
  }

  for (const [time, values] of buckets) {
    if (values.latency !== undefined) series.latency.push({ time, value: values.latency });
    if (values.vus !== undefined) series.vus.push({ time, value: values.vus });
  }
  const latency = series.latency;
  const vus = series.vus;
  const latestRequestTime = requestTimes.at(-1) || Date.now();
  const windowStart = latestRequestTime - 5000;
  const recentRequests = requestTimes.filter((time) => time >= windowStart).length;
  const requestRate = recentRequests / Math.max((latestRequestTime - (requestTimes[0] || latestRequestTime)) / 1000, 5);
  return {
    series,
    sampleCount: requestCount,
    chartPoints: latency.length,
    lastLatency: latency.at(-1)?.value,
    activeVus: vus.at(-1)?.value || 0,
    requestRate
  };
}

async function runK6(runId: string, payload: Record<string, string | number>) {
  if (!Bun.which('k6')) {
    throw new Error('k6 tidak ditemukan. Jalankan image Docker dengan `docker build -t simas-k6-console .` lalu `docker run --rm -p 3000:3000 -v "$PWD/reports:/app/reports" simas-k6-console`, atau pasang k6 dengan `brew install k6`.');
  }

  const summaryPath = join('/tmp', `simas-k6-${runId}.json`);
  const eventsPath = join('/tmp', `simas-k6-${runId}.ndjson`);
  const reportPath = join(reportsDir, `${runId}.json`);
  const env = {
    ...process.env,
    BASE_URL: String(payload.baseUrl),
    HEALTH_PATH: String(payload.path),
    REQUEST_METHOD: String(payload.method || 'GET'),
    TEST_TYPE: String(payload.testType),
    TARGET_VUS: String(payload.targetVus),
    DURATION: String(payload.duration),
    RAMP_UP: String(payload.rampUp),
    HOLD: String(payload.hold),
    RAMP_DOWN: String(payload.rampDown),
    THINK_TIME: String(payload.thinkTime ?? 1),
    DATA_SIZE: String(payload.dataSize || 1000),
    BREAKPOINT_VUS: String(payload.breakpointVus || 200)
  };

  const k6Process = Bun.spawn([
    'k6',
    'run',
    '--quiet',
    '--summary-export',
    summaryPath,
    '--out',
    `json=${eventsPath}`,
    join(root, 'tests/scenario.js')
  ], {
    cwd: root,
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  activeProcess = k6Process;

  const liveTimer = setInterval(() => {
    void readLiveSeries(eventsPath).then((live) => {
      const run = runs.get(runId);
      if (run?.status === 'running') run.live = live;
    });
  }, 700);

  const stdoutPromise = new Response(k6Process.stdout).text();
  const stderrPromise = new Response(k6Process.stderr).text();
  const exitCode = await k6Process.exited;
  clearInterval(liveTimer);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  activeProcess = null;

  let summary: Record<string, unknown> | null = null;
  const summaryFile = Bun.file(summaryPath);
  if (await summaryFile.exists()) {
    summary = await summaryFile.json();
    await Bun.write(summaryPath, '');
  }

  const series = { latency: [], vus: [] } as {
    latency: Array<{ time: string; value: number }>;
    vus: Array<{ time: string; value: number }>;
  };
  const buckets = new Map<string, { latency?: number; vus?: number }>();
  const eventsFile = Bun.file(eventsPath);
  if (await eventsFile.exists()) {
    for (const line of (await eventsFile.text()).split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          metric?: string;
          data?: { time?: string; value?: number };
        };
        if (event.type !== 'Point' || !event.data?.time || !Number.isFinite(event.data.value)) continue;
        const bucket = new Date(event.data.time).toISOString().slice(0, 19);
        const current = buckets.get(bucket) || {};
        if (event.metric === 'http_req_duration') current.latency = event.data.value;
        if (event.metric === 'vus') current.vus = event.data.value;
        buckets.set(bucket, current);
      } catch {
        // Ignore a partial final line when k6 is stopped.
      }
    }
    for (const [time, values] of buckets) {
      if (values.latency !== undefined) series.latency.push({ time, value: values.latency });
      if (values.vus !== undefined) series.vus.push({ time, value: values.vus });
    }
    await Bun.write(eventsPath, '');
  }

  const report = {
    id: runId,
    testType: payload.testType,
    startedAt: runs.get(runId)?.startedAt,
    finishedAt: new Date().toISOString(),
    config: payload,
    summary,
    series
  };
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  const pdfPath = join(reportsDir, `${runId}.pdf`);
  await Bun.write(pdfPath, await createPdfReport(report));

  const run = runs.get(runId);
  if (run) {
    run.status = exitCode === 0 ? 'completed' : 'failed';
    run.exitCode = exitCode;
    run.summary = summary;
    run.output = (stderr || stdout).trim().slice(-5000);
    run.report = report;
    run.reportUrl = `/api/report?id=${runId}`;
    run.pdfUrl = `/api/report/pdf?id=${runId}`;
    run.finishedAt = new Date().toISOString();
  }
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tests' && request.method === 'GET') {
      return json([...testProfiles]);
    }

    if (url.pathname === '/api/run' && request.method === 'POST') {
      if (activeProcess) return json({ error: 'A test is already running.' }, 409);

      const payload = await request.json() as Record<string, string | number>;
      if (!testProfiles.has(String(payload.testType))) {
        return json({ error: 'Unknown test profile.' }, 400);
      }
      if (!payload.baseUrl || !payload.path) {
        return json({ error: 'Base URL and endpoint path are required.' }, 400);
      }

      const runId = randomUUID();
      runs.set(runId, {
        id: runId,
        testType: payload.testType,
        status: 'running',
        startedAt: new Date().toISOString(),
        config: payload
      });
      void runK6(runId, payload).catch((error: Error) => {
        activeProcess = null;
        const run = runs.get(runId);
        if (run) {
          run.status = 'failed';
          run.error = error.message;
          run.finishedAt = new Date().toISOString();
        }
      });
      return json({ runId });
    }

    if (url.pathname === '/api/status' && request.method === 'GET') {
      const run = runs.get(url.searchParams.get('id') || '');
      return run ? json(run) : json({ error: 'Run not found.' }, 404);
    }

    if (url.pathname === '/api/report' && request.method === 'GET') {
      const runId = url.searchParams.get('id') || '';
      const reportFile = Bun.file(join(reportsDir, `${runId}.json`));
      return (await reportFile.exists())
        ? new Response(reportFile, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${runId}.json"` } })
        : json({ error: 'Report not found.' }, 404);
    }

    if (url.pathname === '/api/report/pdf' && request.method === 'GET') {
      const runId = url.searchParams.get('id') || '';
      const reportFile = Bun.file(join(reportsDir, `${runId}.pdf`));
      return (await reportFile.exists())
        ? new Response(reportFile, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${runId}.pdf"` } })
        : json({ error: 'PDF report not found.' }, 404);
    }

    if (url.pathname === '/api/stop' && request.method === 'POST') {
      if (!activeProcess) return json({ error: 'No active test.' }, 409);
      activeProcess.kill();
      return json({ ok: true });
    }

    const filePath = url.pathname === '/' ? join(root, 'web/index.html') : join(root, url.pathname);
    const file = Bun.file(filePath);
    return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
  }
});

console.log(`SIMAS k6 console running at http://localhost:${server.port}`);
