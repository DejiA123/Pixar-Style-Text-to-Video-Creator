// Draws the final frame: the picture plus subtitles and a short fade to black at
// the end. What you see in the player is exactly what gets exported.
import { clamp, smoothstep } from '../util.js';
import { displayName } from '../story/parser.js';

const FONT_BODY = '"Figtree", "Segoe UI", system-ui, sans-serif';

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.subtitles = true;
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

    // subtitles
    const title = tl.shots[0]?.kind === 'title' ? tl.shots[0] : null;
    if (this.subtitles && (!title || t >= title.end - 0.2) && t < tl.endCard.start) {
      const line = film.lineAt(t);
      if (line) {
        const a = clamp((t - line.start) / 0.12) * clamp((line.end + 0.15 - t) / 0.15);
        const who = line.speaker === 'narrator' ? null : displayName(tl.cast.find((c) => c.id === line.speaker));
        this.subtitle(g, W, H, line.text, who, a);
      }
    }

    // the film ends with a short fade to black (no "The End" card)
    if (t >= tl.endCard.start - 0.3) {
      g.save();
      g.globalAlpha = smoothstep(tl.endCard.start - 0.3, tl.endCard.end, t);
      g.fillStyle = '#07080b'; g.fillRect(0, 0, W, H);
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
