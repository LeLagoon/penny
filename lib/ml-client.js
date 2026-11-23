// Starts and talks to the local Python ML service (ml/service.py).
// If Python or scikit-learn is missing, or the service dies, isReady() is false and callers fall
// back to the rule-based engine, so the app keeps working without ML.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

export function createMlClient({ rootDir, port = Number(process.env.ML_PORT) || 5055 }) {
  const token = crypto.randomBytes(24).toString('hex');
  const python = process.env.PYTHON || 'python3';
  const base = `http://127.0.0.1:${port}`;
  const state = { child: null, status: 'off', error: null };
  let pollTimer = null;

  async function request(method, urlPath, body, timeoutMs = 3000) {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'X-ML-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `ML service error ${res.status}`);
    return data;
  }

  async function pollUntilReady(deadline) {
    try {
      const h = await request('GET', '/health', undefined, 1500);
      state.status = h.status === 'ready' && h.model_loaded ? 'ready' : h.status;
      state.error = null;
    } catch (err) {
      if (state.child === null) return; // service already stopped
      state.status = state.status === 'ready' ? 'unavailable' : 'starting';
      state.error = err.message;
    }
    if (state.status !== 'ready' && Date.now() < deadline && state.child) {
      pollTimer = setTimeout(() => pollUntilReady(deadline), 500);
    }
  }

  function start() {
    if (process.env.PENNY_ML === 'off') {
      state.status = 'off';
      console.log('[Penny] ML service disabled (PENNY_ML=off); using rule-based categorisation.');
      return;
    }
    state.status = 'starting';
    const script = path.join(rootDir, 'ml', 'service.py');
    try {
      state.child = spawn(python, ['-W', 'ignore', script], {
        cwd: rootDir,
        env: { ...process.env, ML_PORT: String(port), ML_TOKEN: token, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      state.status = 'unavailable';
      state.error = err.message;
      return;
    }
    const log = prefix => chunk => String(chunk).split('\n').filter(Boolean).forEach(l => console.log(`${prefix} ${l}`));
    state.child.stdout.on('data', log('[Penny ML]'));
    state.child.stderr.on('data', log('[Penny ML!]'));
    state.child.on('error', err => {
      state.status = 'unavailable';
      state.error = `Could not start ${python}: ${err.message}`;
      state.child = null;
      console.warn(`[Penny] ML service unavailable (${state.error}). Using rule-based categorisation.`);
    });
    state.child.on('exit', (code, signal) => {
      if (state.child) {
        state.child = null;
        if (state.status !== 'off') {
          state.status = 'unavailable';
          state.error = signal
            ? `ML service was stopped (${signal}).`
            : `ML service exited (code ${code}). Is scikit-learn installed? (pip install -r requirements.txt)`;
          console.warn(`[Penny] ${state.error} Using rule-based categorisation.`);
        }
      }
    });
    pollUntilReady(Date.now() + 120000);
  }

  function stop() {
    if (pollTimer) clearTimeout(pollTimer);
    const child = state.child;
    state.child = null;
    state.status = 'off';
    if (child && !child.killed) child.kill();
  }

  return {
    start,
    stop,
    isReady: () => state.status === 'ready',
    status: () => ({ status: state.status, error: state.error }),
    // Each call returns the parsed JSON or throws. Callers decide how to fall back.
    predict: text => request('POST', '/predict', { text }),
    predictMany: texts => request('POST', '/predict', { texts }, 10000).then(r => r.predictions),
    feedback: (text, category) => request('POST', '/feedback', { text, category }, 10000),
    metrics: () => request('GET', '/metrics'),
    retrain: () => request('POST', '/retrain', {}, 120000),
    insights: payload => request('POST', '/insights', payload, 10000)
  };
}
