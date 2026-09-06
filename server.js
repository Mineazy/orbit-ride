// OrbitRide NodeJS Express Server
// Provides REST API routes and static asset serving

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate limiting behind Render
app.set('trust proxy', 1);

// In-memory rate limiter
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 100;

const rateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    const requests = (rateLimits.get(ip) || []).filter(t => t > windowStart);
    if (requests.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    requests.push(now);
    rateLimits.set(ip, requests);
    setTimeout(() => { rateLimits.delete(ip); }, RATE_LIMIT_WINDOW);
    next();
};

app.use('/api/', rateLimiter);

// ==========================================
// API Routes
// ==========================================

app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'orbit-ride-api',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/api', (_req, res) => {
    res.json({
        name: 'OrbitRide API',
        version: '2.4.0',
        endpoints: {
            health: '/api/health',
            metrics: '/api/metrics',
            drivers: '/api/drivers',
            rides: '/api/rides',
            passenger: '/api/passenger',
            logs: '/api/logs',
            simulation: '/api/simulation'
        }
    });
});

app.get('/api/metrics', (_req, res) => {
    res.json({ totalTrips: 32, totalRevenue: 542.80, avgRating: 4.91, activeDrivers: 3, pendingRequests: 0 });
});

app.get('/api/drivers', (_req, res) => {
    const status = _req.query.status;
    let drivers = [
        { id: 'driver-1', name: 'Elena Rostova', car: 'Tesla Model Y (White)', rating: 4.92, status: 'OFFLINE', earnings: 124.50, tier: 'OrbitXL' },
        { id: 'driver-2', name: 'Alex Mercer', car: 'Toyota Camry (Silver)', rating: 4.85, status: 'OFFLINE', earnings: 85.00, tier: 'OrbitX' },
        { id: 'driver-3', name: 'Sarah Chen', car: 'Lucid Air (Nebula Blue)', rating: 4.98, status: 'OFFLINE', earnings: 210.00, tier: 'OrbitFly' }
    ];
    if (status) drivers = drivers.filter(d => d.status === status);
    res.json(drivers);
});

app.get('/api/rides', (_req, res) => {
    res.json({ rides: [], total: 0 });
});

app.post('/api/rides', (req, res) => {
    const { passengerId, pickupCoords, dropoffCoords, pickupName, dropoffName, tier } = req.body;
    if (!passengerId || !pickupCoords || !dropoffCoords) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    res.status(201).json({
        id: `ride-${Date.now()}`, passengerId, pickupCoords, dropoffCoords,
        pickupName, dropoffName, tier: tier || 'OrbitX', status: 'REQUESTED',
        fare: 0, distance: 0, timestamp: Date.now()
    });
});

app.get('/api/passenger', (_req, res) => {
    res.json({ id: 'passenger-client', name: 'Hanzu (You)', rating: 4.95, balance: 500.00 });
});

app.put('/api/passenger/balance', (req, res) => {
    const { amount } = req.body;
    res.json({ balance: 500.00 + amount });
});

app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 40;
    res.json({ logs: [{ id: 1, time: new Date().toLocaleTimeString(), text: 'Ride-sharing simulation initialized.', type: 'info' }].slice(0, limit) });
});

app.post('/api/simulation/trigger', (req, res) => {
    const { action } = req.body;
    res.json({ success: true, action, timestamp: Date.now() });
});

// ==========================================
// Serve static assets
// ==========================================

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*any', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// Error handling
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(err.statusCode || 500).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
    });
});

app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 OrbitRide API Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
