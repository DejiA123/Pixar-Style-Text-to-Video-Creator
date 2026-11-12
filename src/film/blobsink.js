// Collects a video file as it is written, in pieces, so a long or 2K download never needs one
// huge block of memory. Each ~4 MB piece becomes a Blob straight away (browsers keep Blob data
// outside the page's own memory, and can put it on disk); the finished file is a Blob of those.
// Writers mostly append, but may go back to fill in a header: any write order works.
const PIECE = 4 * 1024 * 1024;

export class BlobAssembler {
  constructor() {
    this.segs = [];   // finished pieces, in file order, touching: [{ pos, size, blob }]
    this.tail = [];   // bytes appended since the last piece: Uint8Arrays
    this.tailSize = 0;
    this.size = 0;    // file length so far
  }

  flush() {
    if (!this.tailSize) return;
    this.segs.push({ pos: this.size - this.tailSize, size: this.tailSize, blob: new Blob(this.tail) });
    this.tail = []; this.tailSize = 0;
  }

  write(data, position) {
    if (!data.byteLength) return;
    if (position > this.size) this.write(new Uint8Array(position - this.size), this.size);  // a gap: zeros until it's filled in
    if (position === this.size) {  // the usual case: more at the end
      this.tail.push(data.slice());  // the writer may reuse its buffer
      this.tailSize += data.byteLength; this.size += data.byteLength;
      if (this.tailSize >= PIECE) this.flush();
      return;
    }
    // going back: rewrite the part that exists, append whatever sticks out past the end
    this.flush();
    const end = position + data.byteLength;
    const within = Math.min(end, this.size);
    for (const s of this.segs) {
      const a = Math.max(position, s.pos), b = Math.min(within, s.pos + s.size);
      if (a >= b) continue;
      s.blob = new Blob([s.blob.slice(0, a - s.pos), data.slice(a - position, b - position), s.blob.slice(b - s.pos)]);
    }
    if (end > this.size) this.write(data.subarray(this.size - position), this.size);
  }

  blob(type) {
    this.flush();
    return new Blob(this.segs.map((s) => s.blob), { type });
  }

  // for Mediabunny's StreamTarget: chunks arrive as { type: 'write', data, position }
  writable() {
    return new WritableStream({ write: (c) => { if (c?.type === 'write') this.write(c.data, c.position); } });
  }
}
