// OrbitRide NodeJS Host Express Server
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = process.env.PORT || 3000;

// Resolve paths in ES modules context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve compiled assets statically from Vite dist/ folder
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback: redirect all unmatched queries to index.html
app.get('*any', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 OrbitRide Web Service running on port ${port}`);
  console.log(`VITE_SUPABASE_URL config: ${process.env.VITE_SUPABASE_URL ? 'Loaded ✅' : 'Missing ❌'}`);
});
