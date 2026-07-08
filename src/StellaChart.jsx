import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  ScatterChart, Scatter,
  PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';

const PALETTE = ['#22d3ee', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#fb7185'];

// Renders a chart spec produced by the AI (chart-recharts / chart-stella blocks).
export default function StellaChart({ spec }) {
  if (!spec || typeof spec !== 'object') return null;
  const type = String(spec.type || '').toLowerCase();
  const title = spec.title || '📊 Chart';
  const xKey = spec.xKey || 'x';
  const yKey = spec.yKey || 'y';
  const yKeys = Array.isArray(spec.yKeys) ? spec.yKeys : (spec.yKeys ? [spec.yKeys] : []);
  const valueKeys = [...(yKeys.length ? yKeys : [yKey]), spec.valueKey].filter(Boolean);
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
      <h3 className="text-base font-semibold text-cyan-400 mb-3">{title}</h3>
      <div className="w-full h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );

  if (type === 'bar') {
    const series = yKeys.length ? yKeys : [yKey];
    return wrap(
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' }} />
        <Legend />
        {series.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 0, 0]} />)}
      </BarChart>
    );
  }

  if (type === 'line') {
    const series = yKeys.length ? yKeys : [yKey];
    return wrap(
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey={xKey} stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' }} />
        <Legend />
        {series.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
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
