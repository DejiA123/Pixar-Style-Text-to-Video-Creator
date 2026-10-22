// Draws the final frame: the 3D render plus title card, subtitles and the
// end card. What you see in the player is exactly what gets exported.
import { clamp, smoothstep } from '../util.js';
import { displayName } from '../story/parser.js';

const FONT_DISPLAY = '"Bricolage Grotesque", "Avenir Next", "Segoe UI", system-ui, sans-serif';
const FONT_BODY = '"Figtree", "Segoe UI", system-ui, sans-serif';

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.subtitles = true;
    this.credit = 'Animated with Storyreel';
  }

  setSize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  draw(source, film, t) {
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const tl = film.tl;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, W, H);
    const S = Math.min(W, H);

    // title card over the opening shot
    const title = tl.shots[0];
    if (title && title.kind === 'title' && t < title.end) {
      const a = smoothstep(0.6, 1.6, t) * (1 - smoothstep(title.end - 0.9, title.end - 0.1, t));
      if (a > 0.01) {
        g.save();
        g.globalAlpha = a;
        const grd = g.createLinearGradient(0, H * 0.15, 0, H * 0.75);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.38)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, H * 0.15, W, H * 0.6);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#fff';
        g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = S * 0.03; g.shadowOffsetY = S * 0.004;
        const lines = wrap(g, tl.title, W * 0.82, `800 ${Math.round(S * 0.085)}px ${FONT_DISPLAY}`);
        const lh = S * 0.095;
        const y0 = H * 0.45 - ((lines.length - 1) * lh) / 2;
        lines.forEach((ln, i) => g.fillText(ln, W / 2, y0 + i * lh + (1 - smoothstep(0.6, 2.0, t)) * S * 0.02));
        g.shadowBlur = 0;
        g.font = `600 ${Math.round(S * 0.026)}px ${FONT_BODY}`;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.letterSpacing = `${Math.round(S * 0.004)}px`;
        g.fillText('A STORYREEL ORIGINAL', W / 2, y0 + lines.length * lh + S * 0.01);
        g.restore();
      }
    }

    // subtitles
    if (this.subtitles && (!title || t >= title.end - 0.2) && t < tl.endCard.start) {
      const line = film.lineAt(t);
      if (line) {
        const a = clamp((t - line.start) / 0.12) * clamp((line.end + 0.15 - t) / 0.15);
        const who = line.speaker === 'narrator' ? null : displayName(tl.cast.find((c) => c.id === line.speaker));
        this.subtitle(g, W, H, line.text, who, a);
      }
    }

    // end card
    if (t >= tl.endCard.start - 0.3) {
      const a = smoothstep(tl.endCard.start - 0.3, tl.endCard.start + 0.6, t);
      g.save();
      g.globalAlpha = a;
      g.fillStyle = '#07080b'; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = `800 ${Math.round(S * 0.1)}px ${FONT_DISPLAY}`;
      g.fillText('The End', W / 2, H * 0.46);
      g.font = `500 ${Math.round(S * 0.026)}px ${FONT_BODY}`;
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(tl.title, W / 2, H * 0.46 + S * 0.09);
      g.fillStyle = 'rgba(245,184,65,0.9)';
      g.font = `600 ${Math.round(S * 0.02)}px ${FONT_BODY}`;
      g.fillText(this.credit.toUpperCase(), W / 2, H * 0.46 + S * 0.14);
      g.restore();
    }
  }

  subtitle(g, W, H, text, who, alpha) {
    const S = Math.min(W, H);
    const fs = Math.round(S * (W < H ? 0.042 : 0.038));
    const font = `600 ${fs}px ${FONT_BODY}`;
    const lines = wrap(g, text, W * (W < H ? 0.84 : 0.7), font);
    const lh = fs * 1.3;
    const padX = fs * 0.7, padY = fs * 0.45;
    g.save();
    g.globalAlpha = alpha;
    g.font = font;
    const w = Math.max(...lines.map((l) => g.measureText(l).width));
    const nameH = who ? fs * 0.9 : 0;
    const boxH = lines.length * lh + padY * 2 + nameH;
    const y = H * (W < H ? 0.8 : 0.86) - boxH;
    const x = W / 2 - w / 2 - padX;
    g.fillStyle = 'rgba(8,10,14,0.55)';
    roundRect(g, x, y, w + padX * 2, boxH, fs * 0.5);
    g.fill();
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (who) {
      g.font = `700 ${Math.round(fs * 0.68)}px ${FONT_BODY}`;
      g.fillStyle = '#f5b841';
      g.fillText(who.toUpperCase(), W / 2, y + padY * 0.8);
    }
    g.font = font;
    g.fillStyle = '#fff';
    lines.forEach((l, i) => g.fillText(l, W / 2, y + padY + nameH + i * lh));
    g.restore();
  }
}

function wrap(g, text, maxW, font) {
  g.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
