// Generate Pine Notes icon using Electron's offscreen rendering
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512, show: false,
    webPreferences: { offscreen: true }
  });

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html><body style="margin:0;background:transparent">
<canvas id="c" width="512" height="512"></canvas>
<script>
const s = 512;
const c = document.getElementById('c');
const g = c.getContext('2d');

// Rounded square background
const r = 90;
g.beginPath();
g.moveTo(r, 0);
g.lineTo(s - r, 0);
g.quadraticCurveTo(s, 0, s, r);
g.lineTo(s, s - r);
g.quadraticCurveTo(s, s, s - r, s);
g.lineTo(r, s);
g.quadraticCurveTo(0, s, 0, s - r);
g.lineTo(0, r);
g.quadraticCurveTo(0, 0, r, 0);
g.closePath();

// Background gradient
const bg = g.createLinearGradient(0, 0, s, s);
bg.addColorStop(0, '#0a1f13');
bg.addColorStop(1, '#0d2a18');
g.fillStyle = bg;
g.fill();

// Subtle inner glow
const ig = g.createRadialGradient(s*0.35, s*0.3, 0, s*0.5, s*0.5, s*0.6);
ig.addColorStop(0, 'rgba(58, 153, 96, 0.12)');
ig.addColorStop(1, 'rgba(58, 153, 96, 0)');
g.fillStyle = ig;
g.fill();

// Pine tree silhouette (subtle, behind the P)
g.save();
g.globalAlpha = 0.06;
g.fillStyle = '#5ab87a';
// Simple tree shape
g.beginPath();
g.moveTo(380, 100);
g.lineTo(440, 280);
g.lineTo(410, 260);
g.lineTo(460, 400);
g.lineTo(420, 380);
g.lineTo(455, 470);
g.lineTo(335, 470);
g.lineTo(370, 380);
g.lineTo(330, 400);
g.lineTo(380, 260);
g.lineTo(350, 280);
g.closePath();
g.fill();
g.restore();

// Letter "P" - main stroke
g.save();
const px = 120, py = 95;
g.font = 'bold 380px "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
g.textBaseline = 'top';

// P shadow
g.fillStyle = 'rgba(0,0,0,0.3)';
g.fillText('P', px + 4, py + 4);

// P gradient fill
const pg = g.createLinearGradient(px, py, px + 280, py + 380);
pg.addColorStop(0, '#88d4a0');
pg.addColorStop(0.5, '#5ab87a');
pg.addColorStop(1, '#3a9960');
g.fillStyle = pg;
g.fillText('P', px, py);

// Subtle highlight on P
g.globalCompositeOperation = 'overlay';
g.fillStyle = 'rgba(255,255,255,0.08)';
g.fillRect(0, 0, s, s * 0.45);
g.restore();

// Small leaf accent dot
g.beginPath();
g.arc(400, 130, 18, 0, Math.PI * 2);
const dg = g.createRadialGradient(400, 130, 0, 400, 130, 18);
dg.addColorStop(0, '#88d4a0');
dg.addColorStop(1, '#3a9960');
g.fillStyle = dg;
g.fill();
</script>
</body></html>`)}`;

  await win.loadURL(html);

  // Wait for rendering
  await new Promise(r => setTimeout(r, 500));

  const image = await win.webContents.capturePage();
  const pngBuffer = image.toPNG();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngBuffer);
  console.log('icon.png generated (' + pngBuffer.length + ' bytes)');
  app.quit();
});
