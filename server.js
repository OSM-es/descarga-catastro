const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const PUBLIC_DIR = path.join(__dirname);
const EXPORTS_BASE = path.join(PUBLIC_DIR, 'exports');
fs.mkdirSync(EXPORTS_BASE, { recursive: true });

function makeId() { return Date.now().toString(36).toString('hex'); }

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/export', (req, res) => {
  const xmin = req.body.xmin;
  const ymin = req.body.ymin;
  const xmax = req.body.xmax;
  const ymax = req.body.ymax;
  if (![xmin, ymin, xmax, ymax].every(v => v !== undefined)) {
    return res.status(400).send('missing bbox');
  }
  const coords = [xmin, ymin, xmax, ymax].map(Number);
  if (coords.some(c => !isFinite(c))) return res.status(400).send('invalid numbers');

  const script = path.join(__dirname, 'run_export.sh');
  if (!fs.existsSync(script) || !(fs.statSync(script).mode & 0o111)) {
    return res.status(500).send('run_export.sh not found or not executable');
  }

  const child = spawn(script, coords.map(c => String(c)));

  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    child.kill();
  }, 10 * 60 * 1000); // 10 min

  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());

  child.on('close', code => {
    clearTimeout(timeout);
    if (code !== 0) return res.status(500).send(stderr);

    const outpath = stdout.trim();
    if (!outpath || !fs.existsSync(outpath)) return res.status(500).send('Output file not found');

    // Si outpath ya está dentro del PUBLIC_DIR lo usamos; si no, copiamos
    const rel = path.relative(PUBLIC_DIR, outpath).replace(/\\/g, '/');
    let finalPath = outpath;

    if (rel.startsWith('..')) {
      const id = makeId();
      const destDir = path.join(EXPORTS_BASE, id);
      fs.mkdirSync(destDir, { recursive: true });
      finalPath = path.join(destDir, 'combined_buildings.geojson');
      try { fs.copyFileSync(outpath, finalPath); } catch (err) {
        console.error('copy error', err);
        return res.status(500).send('Failed to copy output file');
      }
    }

    const publicRelative = path.relative(PUBLIC_DIR, finalPath).replace(/\\/g, '/');
    const publicUrl = `${req.protocol}://${req.get('host')}/${publicRelative}`; // no encodeURIComponent
    const filename = path.basename(finalPath);
    res.json({ ok: true, filename, publicUrl });
  });
});

const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

const shutdown = () => server.close(() => process.exit(0));

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);