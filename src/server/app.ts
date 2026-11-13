/**
 * AnchorTransport TMS - Full-Stack Express Server Application
 * Mounts secure API proxy routes alongside Vite middleware on Port 3000
 */

process.env.DISABLE_HMR = 'true';

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.routes';
import { firebaseRouter } from './routes/firebase.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { fleetRouter } from './routes/fleet.routes';
import { tripsRouter } from './routes/trips.routes';
import { financialsRouter } from './routes/financials.routes';
import { invoicesRouter } from './routes/invoices.routes';
import { reportsRouter } from './routes/reports.routes';
import { logAuditEvent, getCompanyAuditLogs } from './audit';
import { requireAuth, AuthenticatedRequest } from './auth';
import { serverFleetStore } from './store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root directory of the application
const rootDir = path.resolve(__dirname, '../../');

export const app = express();
export const httpServer = http.createServer(app);

// Parse port from CLI arguments (e.g., --port 3000) or default to 3000
let cliPort: number | null = null;
const portArgIndex = process.argv.indexOf('--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
  const parsed = parseInt(process.argv[portArgIndex + 1], 10);
  if (!isNaN(parsed)) cliPort = parsed;
}
// CLI --port flag takes highest precedence (dev server must run strictly on port 3000).
// In production without CLI --port, use process.env.PORT or fallback to 3000.
const PORT = cliPort !== null ? cliPort : (process.env.NODE_ENV === 'production' && process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
const isProduction = process.env.NODE_ENV === 'production';

// In-memory sliding-window rate limiter for sensitive authentication & financial endpoints
interface RateLimitRecord {
  count: number;
  resetTime: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

function rateLimiter(maxRequests = 100, windowMs = 60 * 1000) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    const record = rateLimitMap.get(key);
    if (!record || now > record.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (record.count >= maxRequests) {
      res.status(429).json({
        success: false,
        error: 'Too many requests. Rate limit exceeded. Please wait before retrying.',
        retryAfterMs: record.resetTime - now,
      });
      return;
    }

    record.count++;
    next();
  };
}

// Security Headers Middleware
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// Core Express Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Apply rate limiting on authentication and write-intensive paths
app.use('/api/auth/login', rateLimiter(20, 60 * 1000));
app.use('/api/auth/register', rateLimiter(10, 60 * 1000));

// Healthcheck Route
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    system: 'AnchorTransport TMS',
    environment: isProduction ? 'production' : 'development',
    version: '1.0.0-phase10',
    timestamp: new Date().toISOString(),
  });
});

// Authentication & Tenant Security API Routes
app.use('/api/auth', authRouter);
app.use('/api/firebase', firebaseRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/fleet', fleetRouter);
app.use('/api', tripsRouter);
app.use('/api', financialsRouter);
app.use('/api/financials', financialsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api', invoicesRouter);
app.use('/api', fleetRouter);
app.use('/api', authRouter);

// Hydrate server in-memory company store from authenticated client Firestore bundle
app.post('/api/sync/hydrate', requireAuth, (req: AuthenticatedRequest, res) => {
  const companyId = req.companyId;
  if (!companyId) {
    res.status(400).json({ success: false, error: 'Active company context is required to hydrate.' });
    return;
  }
  const counts = serverFleetStore.hydrateFromClientBundle(companyId, req.body || {});
  res.json({ success: true, companyId, counts });
});

// Audit Logging & Security Trail API Endpoints
app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const companyId = req.companyId!;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const logs = getCompanyAuditLogs(companyId, limit);
  res.json({ success: true, logs });
});

app.post('/api/audit-logs', requireAuth, async (req: AuthenticatedRequest, res) => {
  const companyId = req.companyId!;
  const { action, entityType, entityId, summary, metadata } = req.body;
  const log = await logAuditEvent({
    companyId,
    userId: req.user?.userId || 'usr_staff',
    userName: req.user?.name || 'Staff User',
    action: action || 'SECURITY',
    entityType: entityType || 'TRIP',
    entityId: entityId || '',
    summary: summary || 'Security event logged',
    metadata: metadata || {},
    ipAddress: req.ip || '',
  });
  res.status(201).json({ success: true, log });
});

// Setup Vite middleware in Development or Serve Static in Production
export async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(rootDir, 'dist');
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`⚓ AnchorTransport TMS Server running at http://0.0.0.0:${PORT} [${isProduction ? 'PROD' : 'DEV'}]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AnchorTransport server:', err);
  process.exit(1);
});
