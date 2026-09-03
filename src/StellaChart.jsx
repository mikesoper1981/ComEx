import { useRef } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar, Line, Area, Scatter,
  PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  RadialBarChart, RadialBar,
  Treemap,
  FunnelChart, Funnel,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import ExcelExportButton, { slugFilename } from './ExcelExportButton';

const PALETTE = ['#22d3ee', '#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#fb7185'];
const AXIS_TICK = { fill: '#94a3b8', fontSize: 12 };
const TOOLTIP_STYLE = { background: '#0f172a', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, color: '#e2e8f0' };

function toNumber(value) {
  if (value == null || value === '') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw = String(value).trim();
  if (!raw) return value;
  const neg = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[£$€¥%\s]/g, '').replace(/,/g, '').replace(/[()]/g, '');
  const n = Number(cleaned);
  if (Number.isFinite(n)) return neg ? -n : n;
  return value;
}

function isNumericLike(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (value == null || value === '') return false;
  return typeof toNumber(value) === 'number' && Number.isFinite(toNumber(value));
}

function compactName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveField(requested, keys) {
  if (requested == null || requested === '') return null;
  const want = String(requested);
  if (keys.includes(want)) return want;
  const compact = compactName(want);
  return keys.find((k) => compactName(k) === compact) || want;
}

function firstPresent(obj, names) {
  for (const name of names) {
    const value = obj?.[name];
    if (value != null && String(value).trim() !== '') return value;
  }
  return null;
}

/** Chart.js / Vega-ish payloads → array of row objects. */
function rowsFromSpec(spec) {
  const data = spec?.data;
  if (Array.isArray(data)) {
    if (!data.length) return [];
    if (Array.isArray(data[0])) {
      return data.map((pair) => {
        const row = { x: pair?.[0], y: pair?.[1] };
        if (pair && pair.length > 2) row.z = pair[2];
        return row;
      });
    }
    return data.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  if (data && typeof data === 'object' && Array.isArray(data.labels) && Array.isArray(data.datasets)) {
    const xName = spec.xKey || spec.categoryKey || spec.labelKey || 'label';
    return data.labels.map((label, i) => {
      const row = { [xName]: label };
      data.datasets.forEach((ds, di) => {
        if (!ds || typeof ds !== 'object') return;
        const key = ds.key || ds.dataKey || ds.field || ds.label || `series${di}`;
        const vals = Array.isArray(ds.data) ? ds.data : [];
        row[key] = vals[i];
      });
      return row;
    });
  }
  if (Array.isArray(spec.labels) && Array.isArray(spec.datasets)) {
    return rowsFromSpec({ ...spec, data: { labels: spec.labels, datasets: spec.datasets } });
  }
  return [];
}

function numericKeysFor(rows, exclude = []) {
  const skip = new Set(exclude.filter(Boolean));
  const keys = Object.keys(rows[0] || {});
  return keys.filter((k) => {
    if (skip.has(k)) return false;
    return rows.some((row) => isNumericLike(row?.[k]));
  });
}

function inferXKey(spec, rows) {
  const keys = Object.keys(rows[0] || {});
  const requested = firstPresent(spec, ['xKey', 'categoryKey', 'labelKey', 'nameKey'])
    || (typeof spec.x === 'string' ? spec.x : (spec.xAxis?.dataKey || spec.xAxis?.key || spec.x?.dataKey));
  if (requested) return resolveField(requested, keys);
  const preferred = ['label', 'name', 'category', 'month', 'period', 'date', 'week', 'quarter', 'year', 'territory', 'region', 'rep', 'x'];
  for (const name of preferred) {
    const hit = keys.find((k) => k.toLowerCase() === name);
    if (hit) return hit;
  }
  const numeric = new Set(numericKeysFor(rows));
  return keys.find((k) => !numeric.has(k)) || keys[0] || 'x';
}

function seriesEntries(spec) {
  const raw = [spec.series, spec.datasets, spec.metrics, spec.yAxes].find(Array.isArray) || [];
  return raw.map((item, i) => {
    if (item == null) return null;
    if (typeof item === 'string') return { key: item, name: item };
    if (typeof item !== 'object') return null;
    const key = item.key || item.dataKey || item.field || item.value || item.yKey || item.y || item.name;
    if (!key) return null;
    return { ...item, key: String(key), _i: i };
  }).filter(Boolean);
}

function axisId(axis) {
  const a = String(axis ?? 'left').toLowerCase();
  if (a === 'right' || a === '1' || a === 'secondary' || a === 'y2') return 1;
  return 0;
}

function markOf(value, fallback = 'bar') {
  const t = String(value || fallback || 'bar').toLowerCase().replace(/[\s_-]+/g, '');
  if (['line', 'spline', 'monotone', 'smooth'].includes(t)) return 'line';
  if (['area', 'stackedarea', 'arearange'].includes(t)) return 'area';
  if (['scatter', 'bubble', 'point', 'dot'].includes(t)) return 'scatter';
  if (['column', 'bar', 'histogram', 'clusteredbar', 'stackedbar'].includes(t)) return 'bar';
  if (['combo', 'composed', 'mixed', 'dual', 'dualaxis', 'combination'].includes(t)) return fallback;
  return t || fallback;
}

function chartKind(spec) {
  return String(spec.type || spec.chartType || spec.kind || spec.chart || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isPolar(kind) {
  return ['pie', 'donut', 'doughnut', 'radar', 'spider', 'radialbar', 'radial', 'nightingale'].includes(kind);
}

function isHierarchical(kind) {
  return ['treemap', 'funnel', 'pyramid'].includes(kind);
}

function isHorizontal(kind, spec) {
  return spec.layout === 'vertical'
    || ['barh', 'horizontalbar', 'horizontalcolumn'].includes(kind);
}

function buildSeries(spec, rows, xKey, kind) {
  const keys = Object.keys(rows[0] || {});
  const listed = seriesEntries(spec).map((s) => ({
    key: resolveField(s.key, keys),
    mark: markOf(s.type || s.chartType || s.kind, markOf(kind, 'bar')),
    axis: axisId(s.axis || s.yAxisId || s.yAxis),
    name: s.name || s.label || s.key,
    stackId: s.stackId || (spec.stacked || /stacked/.test(kind) ? 'stack' : undefined),
  }));
  if (listed.length) return listed;

  const yKeys = Array.isArray(spec.yKeys) ? spec.yKeys : (spec.yKeys ? [spec.yKeys] : []);
  const fallbackKeys = yKeys.length
    ? yKeys
    : [spec.yKey, spec.valueKey, spec.value, spec.y].filter(Boolean);
  if (fallbackKeys.length) {
    const defaultMark = markOf(kind, 'bar');
    return fallbackKeys.map((k) => ({
      key: resolveField(k, keys),
      mark: defaultMark,
      axis: 0,
      name: k,
    }));
  }

  const inferred = numericKeysFor(rows, [xKey]);
  const defaultMark = markOf(kind, 'bar');
  return inferred.map((k) => ({ key: k, mark: defaultMark, axis: 0, name: k }));
}

function coerceRows(rows, series, extraKeys = []) {
  const valueKeys = [...new Set([...series.map((s) => s.key), ...extraKeys].filter(Boolean))];
  return rows.map((row) => {
    const next = { ...row };
    for (const k of valueKeys) {
      if (next[k] != null) next[k] = toNumber(next[k]);
    }
    return next;
  });
}

/** Must return Bar/Line/Area/Scatter elements directly — Recharts inspects child.type. */
function renderMark(series, color, index) {
  const common = {
    key: `${series.mark}-${series.key}-${index}`,
    yAxisId: series.axis,
    xAxisId: 0,
    dataKey: series.key,
    name: series.name,
  };
  if (series.mark === 'line') {
    return (
      <Line
        {...common}
        type="monotone"
        stroke={color}
        strokeWidth={3}
        dot={{ r: 3 }}
        activeDot={{ r: 5 }}
        isAnimationActive={false}
      />
    );
  }
  if (series.mark === 'area') {
    return <Area {...common} type="monotone" stroke={color} fill={color} fillOpacity={0.25} stackId={series.stackId} isAnimationActive={false} />;
  }
  if (series.mark === 'scatter') {
    return <Scatter {...common} fill={color} isAnimationActive={false} />;
  }
  return <Bar {...common} fill={color} radius={[6, 6, 0, 0]} stackId={series.stackId} isAnimationActive={false} />;
}

export default function StellaChart({ spec }) {
  const chartRef = useRef(null);
  if (!spec || typeof spec !== 'object') return null;

  const kind = chartKind(spec);
  const title = spec.title || spec.name || 'Chart';
  const rawRows = rowsFromSpec(spec);
  if (!rawRows.length) {
    return (
      <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 text-xs text-blue-300/70">
        Chart spec was provided but contains no data.
      </div>
    );
  }

  const xKey = inferXKey(spec, rawRows);
  const series = buildSeries(spec, rawRows, xKey, kind);
  const nameKey = resolveField(spec.nameKey || spec.labelKey || xKey, Object.keys(rawRows[0] || {})) || xKey;
  const valueKey = series[0]?.key || resolveField(spec.valueKey || spec.yKey || 'value', Object.keys(rawRows[0] || {}));
  const data = coerceRows(rawRows, series, [valueKey]);

  const wrap = (children) => (
    <div className="stella-chart bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 min-w-0 max-w-full">
      <h3 className="text-base font-semibold text-cyan-400 min-w-0 mb-3 break-words">{title}</h3>
      <div ref={chartRef} className="w-full h-[320px] min-w-0">
        <ResponsiveContainer width="100%" height={320} minWidth={0}>
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

  if (isPolar(kind) && (kind === 'pie' || kind === 'donut' || kind === 'doughnut' || kind === 'nightingale')) {
    const inner = (kind === 'donut' || kind === 'doughnut') ? 55 : kind === 'nightingale' ? 20 : 0;
    return wrap(
      <PieChart>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} outerRadius={110} innerRadius={inner}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
      </PieChart>
    );
  }

  if (kind === 'radar' || kind === 'spider') {
    return wrap(
      <RadarChart data={data}>
        <PolarGrid stroke="#334155" />
        <PolarAngleAxis dataKey={xKey} tick={AXIS_TICK} />
        <PolarRadiusAxis tick={AXIS_TICK} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        {series.map((s, i) => (
          <Radar key={s.key} name={s.name} dataKey={s.key} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.25} />
        ))}
      </RadarChart>
    );
  }

  if (kind === 'radialbar' || kind === 'radial') {
    return wrap(
      <RadialBarChart data={data} innerRadius="20%" outerRadius="90%">
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        <RadialBar dataKey={valueKey} nameKey={nameKey} background>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </RadialBar>
      </RadialBarChart>
    );
  }

  if (isHierarchical(kind) && kind === 'treemap') {
    return wrap(
      <Treemap data={data} dataKey={valueKey} nameKey={nameKey} stroke="#0f172a" fill={PALETTE[0]} />
    );
  }

  if (kind === 'funnel' || kind === 'pyramid') {
    return wrap(
      <FunnelChart>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Funnel data={data} dataKey={valueKey} nameKey={nameKey} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Funnel>
      </FunnelChart>
    );
  }

  // Any other type (bar, line, area, scatter, combo, unknown) is cartesian.
  // Marks come from series[].type / chart type — not a closed whitelist.
  const usesRight = series.some((s) => s.axis === 1);
  const horizontal = isHorizontal(kind, spec);

  if (!series.length) {
    return (
      <div className="bg-slate-900/50 border border-blue-400/30 rounded-lg p-4 my-4 text-xs text-blue-300/70">
        Chart spec has rows but no numeric series could be mapped.
      </div>
    );
  }

  if (horizontal) {
    return wrap(
      <ComposedChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" xAxisId={0} yAxisId={0} />
        <XAxis type="number" xAxisId={0} stroke="#94a3b8" tick={AXIS_TICK} />
        <YAxis type="category" dataKey={xKey} yAxisId={0} stroke="#94a3b8" tick={AXIS_TICK} width={88} interval={0} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend />
        {series.map((s, i) => renderMark({ ...s, axis: 0 }, PALETTE[i % PALETTE.length], i))}
      </ComposedChart>
    );
  }

  return wrap(
    <ComposedChart data={data} margin={{ top: 8, right: usesRight ? 12 : 8, left: 0, bottom: 8 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#334155" xAxisId={0} yAxisId={0} />
      <XAxis dataKey={xKey} xAxisId={0} stroke="#94a3b8" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={24} />
      <YAxis yAxisId={0} stroke="#94a3b8" tick={AXIS_TICK} width={48} />
      {usesRight && <YAxis yAxisId={1} orientation="right" stroke="#94a3b8" tick={AXIS_TICK} width={48} />}
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend />
      {series.map((s, i) => renderMark(s, PALETTE[i % PALETTE.length], i))}
    </ComposedChart>
  );
}
