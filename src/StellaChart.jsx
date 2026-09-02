import { useRef } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart, Bar,
  LineChart, Line,
  ScatterChart, Scatter,
  PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import ExcelExportButton, { slugFilename } from './ExcelExportButton';

const PALETTE = ['#22d3ee', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#fb7185'];
const AXIS_TICK = { fill: '#94a3b8', fontSize: 12 };
const TOOLTIP_STYLE = { background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' };

// Renders a chart spec produced by the AI (chart-recharts / chart-stella blocks).
export default function StellaChart({ spec }) {
  const chartRef = useRef(null);
  if (!spec || typeof spec !== 'object') return null;
  const type = String(spec.type || '').toLowerCase();
  const title = spec.title || '📊 Chart';
  const xKey = spec.xKey || 'x';
  const yKey = spec.yKey || 'y';
  const yKeys = Array.isArray(spec.yKeys) ? spec.yKeys : (spec.yKeys ? [spec.yKeys] : []);
  // Combo/multi-axis series: [{ key, type: 'bar'|'line', axis: 'left'|'right', name }]
  const series = Array.isArray(spec.series)
    ? spec.series.filter(s => s && s.key).map(s => ({
        key: s.key,
        type: String(s.type || 'bar').toLowerCase() === 'line' ? 'line' : 'bar',
        axis: String(s.axis || 'left').toLowerCase() === 'right' ? 'right' : 'left',
        name: s.name || s.key,
      }))
    : [];
  const seriesKeys = series.map(s => s.key);
  const valueKeys = [...new Set([...(yKeys.length ? yKeys : [yKey]), spec.valueKey, ...seriesKeys].filter(Boolean))];
  const data = (Array.isArray(spec.data) ? spec.data : [])
    .filter(d => d && typeof d === 'object')
    .map(d => {
      const row = { ...d };
      for (const k of valueKeys) {
        if (row[k] != null && typeof row[k] !== 'number') {
          const n = Number(String(row[k]).replace(/[,\s%£$€]/g, ''));
          if (Number.isFinite(n)) row[k] = n;
        }
      }
      return row;
    });

  if (!data.length) {
    return (
      <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 text-xs text-blue-300/70">
        Chart spec was provided but contains no data.
      </div>
    );
  }

  const wrap = (children) => (
    <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4">
      <h3 className="text-base font-semibold text-cyan-400 min-w-0 mb-3">{title}</h3>
      <div ref={chartRef} className="w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <div className="flex justify-end mt-1.5">
        <ExcelExportButton
          rows={data}
          sheetName={title}
          filename={slugFilename(title, 'chart')}
          label="Export this chart to Excel"
          chartRef={chartRef}
        />
      </div>
    </div>
  );

  // Combo / dual-axis chart: mix bars and lines, optional secondary Y axis.
  if (type === 'combo' || type === 'composed' || (series.length > 0 && (type === '' || type === 'bar' || type === 'line'))) {
    const effectiveSeries = series.length
      ? series
      : (yKeys.length ? yKeys : [yKey]).map(k => ({ key: k, type: type === 'line' ? 'line' : 'bar', axis: 'left', name: k }));
    const usesRight = effectiveSeries.some(s => s.axis === 'right');
    return wrap(
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} stroke="#94a3b8" tick={AXIS_TICK} />
        <YAxis yAxisId="left" stroke="#94a3b8" tick={AXIS_TICK} />
        {usesRight && <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={AXIS_TICK} />}
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        {effectiveSeries.map((s, i) => (
          s.type === 'line'
            ? <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            : <Bar key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.name} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 0, 0]} />
        ))}
      </ComposedChart>
    );
  }

  if (type === 'bar') {
    const keys = yKeys.length ? yKeys : [yKey];
    return wrap(
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} stroke="#94a3b8" tick={AXIS_TICK} />
        <YAxis stroke="#94a3b8" tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        {keys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 0, 0]} />)}
      </BarChart>
    );
  }

  if (type === 'line') {
    const keys = yKeys.length ? yKeys : [yKey];
    return wrap(
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} stroke="#94a3b8" tick={AXIS_TICK} />
        <YAxis stroke="#94a3b8" tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        {keys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
      </LineChart>
    );
  }

  if (type === 'scatter') {
    return wrap(
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} name={xKey} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis dataKey={yKey} name={yKey} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' }} />
        <Legend />
        <Scatter name={spec.seriesName || yKey} data={data} fill={PALETTE[0]} />
      </ScatterChart>
    );
  }

  if (type === 'pie') {
    const nameKey = spec.nameKey || xKey;
    const valueKey = spec.valueKey || yKey;
    return wrap(
      <PieChart>
        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' }} />
        <Legend />
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} outerRadius={110}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
      </PieChart>
    );
  }

  return (
    <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 text-xs text-blue-300/70">
      Unsupported chart type: <span className="text-cyan-300 font-semibold">{String(spec.type)}</span>
    </div>
  );
}
