// Extracted from api/leaves.js so the parsing logic can be unit-tested.
const zlib = require('zlib');

function extractPdfText(buf) {
  const raw = buf.toString('binary');

  const cidMap = new Map();
  const cmapRe = /begincmap([\s\S]*?)endcmap/g;
  let cm;
  while ((cm = cmapRe.exec(raw)) !== null) {
    const block = cm[1];
    const rangeArrRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+\[([^\]]+)\]/g;
    let rm;
    while ((rm = rangeArrRe.exec(block)) !== null) {
      const start = parseInt(rm[1], 16);
      const unis = [...rm[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => x[1]);
      unis.forEach((h, i) => cidMap.set(start + i, String.fromCodePoint(parseInt(h, 16))));
    }
    const bfcharRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let bm;
    while ((bm = bfcharRe.exec(block)) !== null) {
      const cid = parseInt(bm[1], 16);
      if (!cidMap.has(cid)) cidMap.set(cid, String.fromCodePoint(parseInt(bm[2], 16)));
    }
  }

  const decodeHex = hex => {
    let s = '';
    for (let i = 0; i < hex.length; i += 4)
      s += cidMap.get(parseInt(hex.slice(i, i + 4), 16)) || '';
    return s;
  };

  const parts = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRe.exec(raw)) !== null) {
    let data = Buffer.from(sm[1], 'binary');
    try { data = zlib.inflateSync(data); } catch (_) {}
    const content = data.toString('latin1');

    const hexTjRe = /<([0-9A-Fa-f]{4,})>\s*Tj/g;
    let hm;
    while ((hm = hexTjRe.exec(content)) !== null) {
      const t = decodeHex(hm[1]);
      if (t) parts.push(t);
    }
    const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let tm;
    while ((tm = tjRe.exec(content)) !== null) parts.push(unescapePdf(tm[1]));
    const tjARe = /\[([^\]]*)\]\s*TJ/g;
    while ((tm = tjARe.exec(content)) !== null) {
      const inner = tm[1];
      const sRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let pm;
      while ((pm = sRe.exec(inner)) !== null) parts.push(unescapePdf(pm[1]));
    }
  }

  return parts.join('');
}

function unescapePdf(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
}

function parseLeavePDF(text) {
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return [];
  const date = dateMatch[1];

  const entries = [];
  const segments = text.split(/OD\d+/);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const atIdx = seg.indexOf('@okiedokiepay.com');
    if (atIdx === -1) continue;
    const after = seg.slice(atIdx + '@okiedokiepay.com'.length);
    if (/Cancelled/i.test(after)) continue;

    const dotIdx = seg.lastIndexOf('.', atIdx - 1);
    let name = '';

    if (dotIdx !== -1) {
      const emailLast = seg.slice(dotIdx + 1, atIdx);
      const titleLast = emailLast.charAt(0).toUpperCase() + emailLast.slice(1);
      const titleIdx = seg.indexOf(titleLast);
      if (titleIdx !== -1 && titleIdx < dotIdx) {
        name = seg.slice(0, titleIdx + titleLast.length).trim();
      }
    }

    if (!name || name.length < 2) {
      const local = seg.slice(0, atIdx);
      let start = atIdx;
      while (start > 0 && /[a-z0-9._+-]/.test(local[start - 1])) start--;
      const emailLocal = seg.slice(start, atIdx);
      name = emailLocal.split('.').filter(Boolean)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
    }

    if (name && name.length >= 2) entries.push({ name, date });
  }

  return entries;
}

module.exports = { extractPdfText, parseLeavePDF, unescapePdf };
