import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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

  const stdoutPromise = new Response(k6Process.stdout).text();
  const stderrPromise = new Response(k6Process.stderr).text();
  const exitCode = await k6Process.exited;
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

  const run = runs.get(runId);
  if (run) {
    run.status = exitCode === 0 ? 'completed' : 'failed';
    run.exitCode = exitCode;
    run.summary = summary;
    run.output = (stderr || stdout).trim().slice(-5000);
    run.report = report;
    run.reportUrl = `/api/report?id=${runId}`;
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
