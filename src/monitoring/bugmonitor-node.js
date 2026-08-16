/**
 * ASL Bug Monitor — Node.js / Express SDK
 * =======================================
 * Drop into any Node backend to report server errors to the central
 * monitoring dashboard (https://aslbugmonitor.agricconnect.org).
 *
 * Captures:
 *   - Express error responses (5xx / thrown errors) via the middleware
 *   - uncaughtException / unhandledRejection process-level crashes
 *   - manual captureError(...) calls
 *
 * Usage (Express):
 *   const bugMonitor = require('./bugmonitor-node');
 *   bugMonitor.init({ endpoint: 'https://aslbugmonitor.agricconnect.org', app: 'hms', environment: 'production' });
 *   app.use(bugMonitor.expressErrorMiddleware());   // register BEFORE your error handler
 *   ...
 *   bugMonitor.captureError(err, { severity: 'critical', route: '/patients/new' });
 */

'use strict';

let config = null;
let queue = Promise.resolve();

function defaults() {
  return {
    endpoint: process.env.BUGMONITOR_URL || 'http://localhost:4400',
    app: process.env.BUGMONITOR_APP || 'node-app',
    platform: 'backend',
    environment: process.env.NODE_ENV || 'production',
    appVersion: process.env.npm_package_version || '',
    apiKey: process.env.BUGMONITOR_API_KEY || '',
  };
}

function normalize(err) {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  return new Error(String(err));
}

async function sendReport(payload) {
  const c = config || defaults();
  try {
    const res = await fetch(`${c.endpoint.replace(/\/$/, '')}/api/v1/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.apiKey ? { 'X-Api-Key': c.apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // never let monitoring break the app
  }
}

function captureError(err, opts = {}) {
  const e = normalize(err);
  const c = config || defaults();
  const payload = {
    app: opts.app || c.app,
    platform: c.platform,
    severity: opts.severity || (opts.fatal ? 'critical' : 'high'),
    title: opts.title || `${e.name || 'Error'}: ${e.message || 'unknown'}`.slice(0, 300),
    description: opts.description || undefined,
    error_type: opts.errorType || e.name || 'Error',
    stack_trace: e.stack ? String(e.stack).slice(0, 8000) : undefined,
    route: opts.route,
    environment: opts.environment || c.environment,
    app_version: opts.appVersion || c.appVersion,
    tags: Array.isArray(opts.tags) ? opts.tags : [],
  };
  // Serialize so bursts don't overwhelm the API
  queue = queue.then(() => sendReport(payload));
  return queue;
}

function captureMessage(message, opts = {}) {
  const c = config || defaults();
  return captureError(new Error(String(message)), {
    ...opts,
    title: String(message).slice(0, 300),
    errorType: opts.errorType || 'Message',
    severity: opts.severity || 'low',
  });
}

/**
 * Express error middleware. Reports the error to the monitor, then forwards
 * to the next error handler so existing behaviour is unchanged.
 * Register with app.use() AFTER your routes, BEFORE your existing error handler.
 */
function expressErrorMiddleware() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = res.statusCode >= 400 ? res.statusCode : 500;
    captureError(err, {
      severity: status >= 500 ? 'critical' : 'high',
      route: req ? `${req.method} ${req.originalUrl || req.url}` : undefined,
      errorType: err.name || 'HttpError',
      description: `HTTP ${status} — ${req ? req.method : ''} ${req ? (req.originalUrl || req.url) : ''}`,
      tags: ['backend', `status:${status}`],
    });
    next(err); // existing handler keeps full control of the response
  };
}

/** Report an unhandled rejection / uncaught exception (called by process hooks). */
function reportProcessCrash(err, kind) {
  captureError(err, {
    severity: 'critical',
    fatal: true,
    title: `[${kind}] ${err && err.message ? err.message : String(err)}`,
    errorType: kind,
    tags: ['backend', 'crash', kind.toLowerCase()],
  });
}

/**
 * Express middleware that reports 5xx responses even when the route handled
 * the error itself (no exception reaches the error middleware). Register with
 * app.use() right after routes; listens on 'finish' so it captures the final
 * status code without changing the response.
 */
function responseStatusMonitor() {
  return (req, res, next) => {
    res.on('finish', () => {
      const status = res.statusCode;
      if (status >= 500) {
        captureError(new Error(`HTTP ${status} ${req.method} ${req.originalUrl || req.url}`), {
          severity: 'critical',
          route: `${req.method} ${req.originalUrl || req.url}`,
          errorType: 'Http5xx',
          description: `HTTP ${status} — ${req.method} ${req.originalUrl || req.url}`,
          tags: ['backend', `status:${status}`],
        });
      }
    });
    next();
  };
}

function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    reportProcessCrash(reason instanceof Error ? reason : new Error(String(reason)), 'UnhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    reportProcessCrash(err, 'UncaughtException');
  });
}

function init(options = {}) {
  config = {
    ...defaults(),
    ...options,
  };
  if (options.installProcessHandlers !== false) installProcessHandlers();
  return exports;
}

module.exports = {
  init,
  captureError,
  captureMessage,
  expressErrorMiddleware,
  responseStatusMonitor,
  reportProcessCrash,
};
