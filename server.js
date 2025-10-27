const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/export', (req, res) => {
  const xmin = req.body.xmin;
  const ymin = req.body.ymin;
  const xmax = req.body.xmax;
  const ymax = req.body.ymax;
  if (![xmin,ymin,xmax,ymax].every(v => v !== undefined)) {
    return res.status(400).send('missing bbox');
  }
  const coords = [xmin,ymin,xmax,ymax].map(Number);
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
    if (code !== 0) {
      return res.status(500).send('Script error:\n' + stderr);
    }
    const outpath = stdout.trim();
    if (!fs.existsSync(outpath)) return res.status(500).send('Output file not found');

    res.download(outpath, 'combined_buildings.geojson', err => {
      const outdir = path.dirname(outpath);
      try { fs.rmSync(outdir, { recursive: true, force: true }); } catch(e){ console.error(e); }
    });
  });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
