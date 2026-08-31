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

export async function downloadRowsAsExcel({ rows, sheetName = 'Sheet1', filename = 'export' } = {}) {
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
  const ws = Array.isArray(first)
    ? XLSX.utils.aoa_to_sheet(prepared)
    : XLSX.utils.json_to_sheet(prepared);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));
  XLSX.writeFile(wb, `${slugFilename(filename)}.xlsx`);
}

export default function ExcelExportButton({
  rows,
  sheetName = 'Sheet1',
  filename = 'export',
  label = 'Export to Excel',
  className = '',
}) {
  const [busy, setBusy] = useState(false);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadRowsAsExcel({ rows, sheetName, filename });
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
