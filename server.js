// OrbitRide NodeJS Express Server
// Provides REST API routes, CORS handling, and static asset serving

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3000;

// Resolve paths in ES modules context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// Middleware
// ==========================================

// Security headers
app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "https:", "data:"],
            connectSrc: ["'self'", "wss://*.supabase.co", "https://*.supabase.co"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
        }
    }
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
    maxAge: 86400,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);

// Logging
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
}

// JSON parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==========================================
// API Routes
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'orbit-ride-api',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API info
app.get('/api', (req, res) => {
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

// Metrics endpoint
app.get('/api/metrics', (req, res) => {
    try {
        res.json({
            totalTrips: 32,
            totalRevenue: 542.80,
            avgRating: 4.91,
            activeDrivers: 3,
            pendingRequests: 0
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

// Drivers endpoint
app.get('/api/drivers', (req, res) => {
    try {
        const status = req.query.status;
        let drivers = [
            { id: 'driver-1', name: 'Elena Rostova', car: 'Tesla Model Y (White)', rating: 4.92, status: 'OFFLINE', earnings: 124.50, tier: 'OrbitXL' },
            { id: 'driver-2', name: 'Alex Mercer', car: 'Toyota Camry (Silver)', rating: 4.85, status: 'OFFLINE', earnings: 85.00, tier: 'OrbitX' },
            { id: 'driver-3', name: 'Sarah Chen', car: 'Lucid Air (Nebula Blue)', rating: 4.98, status: 'OFFLINE', earnings: 210.00, tier: 'OrbitFly' }
        ];
        if (status) {
            drivers = drivers.filter(d => d.status === status);
        }
        res.json(drivers);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch drivers' });
    }
});

// Rides endpoint
app.get('/api/rides', (req, res) => {
    try {
        res.json({ rides: [], total: 0 });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch rides' });
    }
});

app.post('/api/rides', (req, res) => {
    try {
        const { passengerId, pickupCoords, dropoffCoords, pickupName, dropoffName, tier } = req.body;
        if (!passengerId || !pickupCoords || !dropoffCoords) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const ride = {
            id: `ride-${Date.now()}`,
            passengerId,
            pickupCoords,
            dropoffCoords,
            pickupName,
            dropoffName,
            tier: tier || 'OrbitX',
            status: 'REQUESTED',
            fare: 0,
            distance: 0,
            timestamp: Date.now()
        };
        res.status(201).json(ride);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create ride' });
    }
});

// Passenger endpoint
app.get('/api/passenger', (req, res) => {
    try {
        res.json({
            id: 'passenger-client',
            name: 'Hanzu (You)',
            rating: 4.95,
            balance: 500.00
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch passenger data' });
    }
});

app.put('/api/passenger/balance', (req, res) => {
    try {
        const { amount } = req.body;
        res.json({ balance: 500.00 + amount });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update balance' });
    }
});

// Logs endpoint
app.get('/api/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 40;
        res.json({
            logs: [
                { id: 1, time: new Date().toLocaleTimeString(), text: 'Ride-sharing simulation initialized.', type: 'info' }
            ].slice(0, limit)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Simulation control endpoints
app.post('/api/simulation/trigger', (req, res) => {
    try {
        const { action } = req.body;
        res.json({ success: true, action, timestamp: Date.now() });
    } catch (err) {
        res.status(500).json({ error: 'Simulation trigger failed' });
    }
});

// ==========================================
// Serve static assets
// ==========================================

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback
app.get('*any', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// ==========================================
// Error handling
// ==========================================

app.use((err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ==========================================
// Start server
// ==========================================

app.listen(port, () => {
    console.log(`🚀 OrbitRide API Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Supabase URL configured: ${process.env.VITE_SUPABASE_URL ? '✅' : '❌'}`);
    console.log(`Google Maps Key configured: ${process.env.VITE_GOOGLE_MAPS_API_KEY ? '✅' : '❌'}`);
});

export default app;
