const STROKE_WIDTH = 3;
const ARROW_HEAD_LEN = 12;

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function hexToRgb(hex) {
  const clean = String(hex || '#ef4444').replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function shapeToSvg(shape, width, height) {
  const color = escapeXml(shape.color || '#ef4444');

  if (shape.tool === 'pen' || shape.tool === 'highlighter') {
    const points = (shape.points || []).map((p) => `${p.x * width},${p.y * height}`).join(' ');
    const isHighlighter = shape.tool === 'highlighter';
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${isHighlighter ? STROKE_WIDTH * 4 : STROKE_WIDTH}" stroke-opacity="${isHighlighter ? 0.38 : 1}" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  if (shape.tool === 'line' || shape.tool === 'arrow') {
    const x1 = shape.x1 * width;
    const y1 = shape.y1 * height;
    const x2 = shape.x2 * width;
    const y2 = shape.y2 * height;
    const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" />`;
    if (shape.tool === 'line') return line;

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const hx1 = x2 - ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6);
    return `<g stroke="${color}" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round">${line}<polyline points="${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}" /></g>`;
  }

  if (shape.tool === 'rect') {
    const x = Math.min(shape.x1, shape.x2) * width;
    const y = Math.min(shape.y1, shape.y2) * height;
    const w = Math.abs(shape.x2 - shape.x1) * width;
    const h = Math.abs(shape.y2 - shape.y1) * height;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" />`;
  }

  if (shape.tool === 'circle') {
    const x1 = shape.x1 * width;
    const y1 = shape.y1 * height;
    const x2 = shape.x2 * width;
    const y2 = shape.y2 * height;
    return `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" />`;
  }

  return '';
}

export function buildAnnotationSvg(shapes, title, width = 1280, height = 720) {
  const label = escapeXml(title || 'NexMeet annotations');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#020617" />',
    `<text x="24" y="38" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18">${label}</text>`,
    `<g transform="translate(0 56)">${shapes.map((shape) => shapeToSvg(shape, width, height - 56)).join('')}</g>`,
    '</svg>',
  ].join('');
}

export async function downloadAnnotationPng(shapes, title, fileName) {
  const width = 1280;
  const height = 720;
  const svg = buildAnnotationSvg(shapes, title, width, height);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  canvas.toBlob((pngBlob) => {
    if (pngBlob) downloadBlob(pngBlob, fileName);
  }, 'image/png');
}

function pdfEscape(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function pdfLine(x1, y1, x2, y2) {
  return `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function shapeToPdf(shape, width, height) {
  const { r, g, b } = hexToRgb(shape.color);
  const color = `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG`;
  const base = [`q`, color, `${shape.tool === 'highlighter' ? STROKE_WIDTH * 4 : STROKE_WIDTH} w`, '1 J 1 j'];

  if (shape.tool === 'pen' || shape.tool === 'highlighter') {
    const points = shape.points || [];
    if (points.length < 2) return '';
    const alpha = shape.tool === 'highlighter' ? '/GS1 gs' : '';
    const path = points.map((p, index) => {
      const x = p.x * width;
      const y = height - (p.y * height);
      return `${x.toFixed(2)} ${y.toFixed(2)} ${index === 0 ? 'm' : 'l'}`;
    }).join(' ');
    return [...base, alpha, `${path} S`, 'Q'].filter(Boolean).join('\n');
  }

  const x1 = shape.x1 * width;
  const y1 = height - (shape.y1 * height);
  const x2 = shape.x2 * width;
  const y2 = height - (shape.y2 * height);

  if (shape.tool === 'line') return [...base, pdfLine(x1, y1, x2, y2), 'Q'].join('\n');

  if (shape.tool === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const hx1 = x2 - ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6);
    return [...base, pdfLine(x1, y1, x2, y2), pdfLine(hx1, hy1, x2, y2), pdfLine(hx2, hy2, x2, y2), 'Q'].join('\n');
  }

  if (shape.tool === 'rect') {
    const x = Math.min(shape.x1, shape.x2) * width;
    const y = height - (Math.max(shape.y1, shape.y2) * height);
    const w = Math.abs(shape.x2 - shape.x1) * width;
    const h = Math.abs(shape.y2 - shape.y1) * height;
    return [...base, `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`, 'Q'].join('\n');
  }

  if (shape.tool === 'circle') {
    const cx = ((shape.x1 + shape.x2) / 2) * width;
    const cy = height - (((shape.y1 + shape.y2) / 2) * height);
    const rx = Math.abs(shape.x2 - shape.x1) * width / 2;
    const ry = Math.abs(shape.y2 - shape.y1) * height / 2;
    const c = 0.5522847498;
    return [
      ...base,
      `${(cx + rx).toFixed(2)} ${cy.toFixed(2)} m`,
      `${(cx + rx).toFixed(2)} ${(cy + c * ry).toFixed(2)} ${(cx + c * rx).toFixed(2)} ${(cy + ry).toFixed(2)} ${cx.toFixed(2)} ${(cy + ry).toFixed(2)} c`,
      `${(cx - c * rx).toFixed(2)} ${(cy + ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${(cy + c * ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} c`,
      `${(cx - rx).toFixed(2)} ${(cy - c * ry).toFixed(2)} ${(cx - c * rx).toFixed(2)} ${(cy - ry).toFixed(2)} ${cx.toFixed(2)} ${(cy - ry).toFixed(2)} c`,
      `${(cx + c * rx).toFixed(2)} ${(cy - ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${(cy - c * ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} c S`,
      'Q',
    ].join('\n');
  }

  return '';
}

export function downloadAnnotationPdf(shapes, title, fileName) {
  const width = 960;
  const height = 540;
  const headerHeight = 42;
  const bodyHeight = height - headerHeight;
  const content = [
    'q 0.008 0.024 0.090 rg 0 0 960 540 re f Q',
    'BT /F1 16 Tf 24 512 Td 0.580 0.639 0.722 rg',
    `(${pdfEscape(title || 'NexMeet annotations')}) Tj ET`,
    `q 1 0 0 1 0 -${headerHeight} cm`,
    ...shapes.map((shape) => shapeToPdf(shape, width, bodyHeight)),
    'Q',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> /ExtGState << /GS1 << /ca 0.38 /CA 0.38 >> >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  downloadBlob(new Blob([pdf], { type: 'application/pdf' }), fileName);
}
