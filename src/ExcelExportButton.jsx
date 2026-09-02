import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';

function slugFilename(raw, fallback = 'export') {
  const s = String(raw || '')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .toLowerCase();
  return s || fallback;
}

function sanitizeSheetName(raw) {
  const s = String(raw || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return s || 'Sheet1';
}

function stripCell(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return String(value)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function pxToEmu(px) {
  return Math.max(1, Math.round(Number(px) * 9525));
}

function inlineSvgComputedStyles(source, clone) {
  const srcNodes = [source, ...source.querySelectorAll('*')];
  const dstNodes = [clone, ...clone.querySelectorAll('*')];
  const count = Math.min(srcNodes.length, dstNodes.length);
  for (let i = 0; i < count; i++) {
    const src = srcNodes[i];
    const dst = dstNodes[i];
    if (!src || !dst || src.nodeType !== 1) continue;
    const cs = window.getComputedStyle(src);
    const fill = cs.fill;
    const stroke = cs.stroke;
    if (fill && fill !== 'none') dst.setAttribute('fill', fill);
    if (stroke && stroke !== 'none') dst.setAttribute('stroke', stroke);
    if (cs.strokeWidth && cs.strokeWidth !== '0px') dst.setAttribute('stroke-width', cs.strokeWidth);
    if (cs.fontSize) dst.setAttribute('font-size', cs.fontSize);
    if (cs.fontFamily) dst.setAttribute('font-family', cs.fontFamily);
    if (cs.fontWeight && cs.fontWeight !== '400') dst.setAttribute('font-weight', cs.fontWeight);
    if (cs.opacity && cs.opacity !== '1') dst.setAttribute('opacity', cs.opacity);
  }
}

export async function captureElementPng(el, { background = '#0f172a', scale = 2 } = {}) {
  if (!el || typeof el.querySelector !== 'function') return null;
  const svg = el.tagName === 'svg' ? el : el.querySelector('svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  inlineSvgComputedStyles(svg, clone);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = svg.getBoundingClientRect();
  const vb = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : 0;
  const vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : 0;
  const width = Math.max(1, Math.round(box.width || svg.clientWidth || vbW || 800));
  const height = Math.max(1, Math.round(box.height || svg.clientHeight || vbH || 320));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox') && vbW && vbH) clone.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Could not rasterise chart'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width,
    height,
  };
}

function drawingXml({ widthEmu, heightEmu }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="${widthEmu}" cy="${heightEmu}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

async function embedPngInFirstSheet(xlsxBuf, png, { width, height } = {}) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(xlsxBuf);
  zip.file('xl/media/image1.png', png);
  zip.file('xl/drawings/drawing1.xml', drawingXml({
    widthEmu: pxToEmu(width || 800),
    heightEmu: pxToEmu(height || 320),
  }));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`);

  const sheetPath = Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
    || Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetPath) throw new Error('Workbook has no worksheet');
  let sheetXml = await zip.file(sheetPath).async('string');
  if (!/<drawing[\s/>]/i.test(sheetXml)) {
    sheetXml = sheetXml.replace(/<\/worksheet>\s*$/i, '<drawing r:id="rIdChart"/>\n</worksheet>');
    zip.file(sheetPath, sheetXml);
  }
  const relsPath = sheetPath.replace(/worksheets\/([^/]+)$/i, 'worksheets/_rels/$1.rels');
  const existingRels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '';
  if (!existingRels) {
    zip.file(relsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`);
  } else if (!existingRels.includes('drawing1.xml')) {
    zip.file(relsPath, existingRels.replace(
      /<\/Relationships>\s*$/i,
      '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>\n</Relationships>',
    ));
  }

  let types = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="png"/i.test(types)) {
    types = types.replace(
      /<Types[^>]*>/,
      (m) => `${m}\n<Default Extension="png" ContentType="image/png"/>`,
    );
  }
  if (!/drawings\/drawing1\.xml/i.test(types)) {
    types = types.replace(
      /<\/Types>\s*$/i,
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\n</Types>',
    );
  }
  zip.file('[Content_Types].xml', types);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadRowsAsExcel({
  rows,
  sheetName = 'Sheet1',
  filename = 'export',
  chartImage = null,
} = {}) {
  if (!Array.isArray(rows) || !rows.length) return;
  const xlsxMod = await import('xlsx');
  const XLSX = xlsxMod?.default || xlsxMod;
  const first = rows[0];
  const prepared = Array.isArray(first)
    ? rows.map((row) => (Array.isArray(row) ? row.map(stripCell) : row))
    : rows.map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row || {})) out[k] = stripCell(v);
      return out;
    });
  const dataSheet = Array.isArray(first)
    ? XLSX.utils.aoa_to_sheet(prepared)
    : XLSX.utils.json_to_sheet(prepared);
  const wb = XLSX.utils.book_new();
  const fileBase = slugFilename(filename);
  if (chartImage?.bytes) {
    const chartSheet = XLSX.utils.aoa_to_sheet([['Chart'], ['']]);
    XLSX.utils.book_append_sheet(wb, chartSheet, 'Chart');
    XLSX.utils.book_append_sheet(wb, dataSheet, sanitizeSheetName(sheetName === 'Chart' ? 'Data' : sheetName) || 'Data');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = await embedPngInFirstSheet(buf, chartImage.bytes, {
      width: chartImage.width,
      height: chartImage.height,
    });
    triggerDownload(blob, `${fileBase}.xlsx`);
    return;
  }
  XLSX.utils.book_append_sheet(wb, dataSheet, sanitizeSheetName(sheetName));
  XLSX.writeFile(wb, `${fileBase}.xlsx`);
}

export default function ExcelExportButton({
  rows,
  sheetName = 'Sheet1',
  filename = 'export',
  label = 'Export to Excel',
  className = '',
  chartRef = null,
}) {
  const [busy, setBusy] = useState(false);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      let chartImage = null;
      const node = chartRef?.current;
      if (node) {
        try {
          chartImage = await captureElementPng(node);
        } catch (err) {
          console.warn('Chart image capture failed, exporting data only', err);
        }
      }
      await downloadRowsAsExcel({ rows, sheetName, filename, chartImage });
    } catch (err) {
      console.error('Excel export failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={handleClick}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/90 border border-blue-400/30 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400/50 hover:text-cyan-100 disabled:opacity-40 shrink-0 ${className}`}
    >
      <FileSpreadsheet className={`w-3.5 h-3.5 ${busy ? 'opacity-50' : ''}`} />
    </button>
  );
}

export { slugFilename };
