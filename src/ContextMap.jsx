import { useMemo, useState } from 'react';
import {
  ChevronRight,
  DollarSign,
  FileText,
  Layers,
  Link2,
  Map as MapIcon,
  Network,
  UserCog,
} from 'lucide-react';
import { activeMemoryItems } from './chatMemory';
import {
  connectedModuleIds,
  listModuleContextBlocks,
  MODULE_CONTEXT_LABELS,
} from './moduleContext';

const MODULES = [
  {
    id: 'incentives',
    title: 'Incentive Compensation',
    short: 'Incentives',
    Icon: DollarSign,
    fill: '#38bdf8',
    iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-500',
    pane: 'incentives',
    angle: (5 * Math.PI) / 6,
  },
  {
    id: 'territory',
    title: 'Territory Design',
    short: 'Territory',
    Icon: MapIcon,
    fill: '#34d399',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500',
    pane: 'territory',
    angle: -Math.PI / 2,
  },
  {
    id: 'stella',
    title: 'Stella Insights',
    short: 'Stella',
    Icon: Layers,
    fill: '#22d3ee',
    iconBg: 'bg-gradient-to-br from-cyan-500 to-blue-500',
    pane: 'stella',
    angle: Math.PI / 6,
  },
];

const ACCOUNT_FIELDS = [
  ['companyName', 'Company'],
  ['industry', 'Industry'],
  ['role', 'Role'],
  ['currency', 'Currency / units'],
  ['metrics', 'Metrics & definitions'],
  ['abbreviations', 'Terminology'],
  ['preferences', 'Preferences'],
  ['constraints', 'Hard constraints'],
  ['customContext', 'Additional context'],
];

const CANVAS = { w: 1100, h: 720, cx: 550, cy: 355, moduleR: 228, leafR: 124 };

function clip(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function filledAccountFields(settings) {
  return ACCOUNT_FIELDS
    .map(([key, label]) => ({ key, label, value: String(settings?.[key] || '').trim() }))
    .filter((f) => f.value);
}

function contextFileSummary(file) {
  const blocks = listModuleContextBlocks(file) || [];
  const highlights = blocks
    .slice(0, 4)
    .map((b) => {
      if (b.qa) return clip(b.answer || b.question, 90);
      return clip(b.value, 90);
    })
    .filter(Boolean);
  return {
    id: file.id,
    name: file.name || 'File',
    kind: file.fileType || 'file',
    intakeComplete: !!file.intakeComplete,
    processing: !!file.processing,
    highlights,
    blockCount: blocks.length,
  };
}

function stellaFileSummary(file) {
  const ctx = file?.capturedContext && typeof file.capturedContext === 'object' ? file.capturedContext : {};
  const maps = Array.isArray(ctx.name_maps) ? ctx.name_maps.filter((m) => m?.from && m?.to) : [];
  const qa = Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs.filter((p) => p && (p.question || p.answer)) : [];
  const rels = Array.isArray(ctx.relationships) ? ctx.relationships.filter((r) => r && (r.this_field || r.related_file || r.related_table)) : [];
  return {
    id: file.id,
    name: file.name || 'File',
    tableName: file.tableName || '',
    rowCount: file.rowCount,
    intakeComplete: !!(file.intakeComplete || file.capturedContext),
    represents: clip(ctx.what_it_represents, 120),
    period: clip(ctx.time_period, 80),
    metrics: (Array.isArray(ctx.key_metrics) ? ctx.key_metrics : []).map((m) => String(m || '').trim()).filter(Boolean).slice(0, 4),
    maps: maps.slice(0, 4).map((m) => `${m.from} → ${m.to}`),
    qaCount: qa.length,
    joinCount: rels.length,
  };
}

function stellaJoinEdges(files) {
  const list = (files || []).filter((f) => f && !f.processing);
  const byTable = new Map();
  const byName = new Map();
  for (const f of list) {
    if (f.tableName) byTable.set(String(f.tableName).toLowerCase(), f);
    byName.set(String(f.name || '').toLowerCase(), f);
  }
  const seen = new Set();
  const edges = [];
  for (const f of list) {
    const rels = Array.isArray(f.capturedContext?.relationships) ? f.capturedContext.relationships : [];
    for (const r of rels) {
      if (!r) continue;
      const other = (
        (r.related_table && byTable.get(String(r.related_table).toLowerCase()))
        || (r.related_file && byName.get(String(r.related_file).toLowerCase()))
      );
      if (!other || other.id === f.id) continue;
      const tf = String(r.this_field || '').trim();
      const rf = String(r.related_field || '').trim();
      if (!tf || !rf) continue;
      const pair = [f.id, other.id].sort().join('|');
      const key = `${pair}|${[tf, rf].map((s) => s.toLowerCase()).sort().join('=')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        fromId: f.id,
        toId: other.id,
        fromName: f.name,
        toName: other.name,
        label: `${tf} ↔ ${rf}`,
      });
    }
  }
  return edges;
}

function memoryFor(settings, moduleId) {
  const items = activeMemoryItems(settings);
  if (!moduleId) return items.filter((m) => !m.module);
  return items.filter((m) => m.module === moduleId);
}

function clampNode(n) {
  const pad = 8;
  return {
    ...n,
    x: Math.min(CANVAS.w - n.w / 2 - pad, Math.max(n.w / 2 + pad, n.x)),
    y: Math.min(CANVAS.h - n.h / 2 - pad, Math.max(n.h / 2 + pad, n.y)),
  };
}

function polar(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function fanAngles(centerAngle, count, spread) {
  if (count <= 1) return [centerAngle];
  const start = centerAngle - spread / 2;
  return Array.from({ length: count }, (_, i) => start + (spread * i) / (count - 1));
}

function edgePath(a, b, kind, hub) {
  if (kind === 'share' || kind === 'join') {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const vx = mx - hub.x;
    const vy = my - hub.y;
    const len = Math.hypot(vx, vy) || 1;
    const bump = kind === 'share' ? 56 : 28;
    const qx = mx + (vx / len) * bump;
    const qy = my + (vy / len) * bump;
    return {
      d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`,
      labelX: (mx + qx) / 2,
      labelY: (my + qy) / 2,
    };
  }
  return {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
    labelX: (a.x + b.x) / 2,
    labelY: (a.y + b.y) / 2,
  };
}

function layoutStar(model) {
  const nodes = [];
  const edges = [];
  const { cx, cy, moduleR, leafR } = CANVAS;

  nodes.push(clampNode({
    id: 'account',
    kind: 'hub',
    x: cx,
    y: cy,
    w: 176,
    h: 86,
    title: 'Account',
    subtitle: `${model.accountFields.length} setting${model.accountFields.length === 1 ? '' : 's'} · ${model.generalMemory.length} fact${model.generalMemory.length === 1 ? '' : 's'}`,
  }));

  const hubSatellites = [];
  if (model.accountFields.length) {
    hubSatellites.push({
      id: 'account-settings',
      kind: 'hub-leaf',
      title: 'General settings',
      subtitle: model.accountFields.map((f) => f.label).slice(0, 3).join(' · '),
      w: 132,
      h: 46,
    });
  }
  if (model.generalMemory.length) {
    hubSatellites.push({
      id: 'account-memory',
      kind: 'memory',
      title: 'Chat memory',
      subtitle: `${model.generalMemory.length} standing fact${model.generalMemory.length === 1 ? '' : 's'}`,
      w: 132,
      h: 46,
    });
  }
  fanAngles(Math.PI / 2, hubSatellites.length, 0.7).forEach((ang, i) => {
    const p = polar(cx, cy, 108, ang);
    const leaf = clampNode({ ...hubSatellites[i], x: p.x, y: p.y, moduleId: 'account' });
    nodes.push(leaf);
    edges.push({ from: 'account', to: leaf.id, kind: 'spoke', label: '' });
  });

  for (const mod of model.modules) {
    const p = polar(cx, cy, moduleR, mod.angle);
    nodes.push(clampNode({
      id: mod.id,
      kind: 'module',
      moduleId: mod.id,
      x: p.x,
      y: p.y,
      w: 158,
      h: 70,
      title: mod.short,
      subtitle: mod.linked.length
        ? `Sharing with ${mod.linked.map((id) => MODULES.find((m) => m.id === id)?.short || id).join(', ')}`
        : 'Standalone',
      fill: mod.fill,
    }));
    edges.push({ from: 'account', to: mod.id, kind: 'spoke', label: 'always' });

    const leaves = [];
    if (mod.pptx) {
      leaves.push({
        id: `${mod.id}-pptx`,
        kind: 'leaf',
        title: 'PPT template',
        subtitle: clip(mod.pptx.fileName || 'Custom', 22),
        w: 128,
        h: 44,
      });
    }
    if (mod.goals) {
      leaves.push({
        id: `${mod.id}-goals`,
        kind: 'leaf',
        title: 'Analysis goals',
        subtitle: clip(mod.goals, 22),
        w: 128,
        h: 44,
      });
    }
    mod.files.slice(0, 4).forEach((f) => {
      leaves.push({
        id: `ctx-${f.id}`,
        kind: 'file',
        fileId: f.id,
        title: clip(f.name, 20),
        subtitle: 'Context file',
        w: 128,
        h: 44,
      });
    });
    if (mod.files.length > 4) {
      leaves.push({
        id: `${mod.id}-more-ctx`,
        kind: 'leaf',
        title: `+${mod.files.length - 4} more files`,
        subtitle: 'Context',
        w: 128,
        h: 44,
      });
    }
    mod.stellaFiles.slice(0, 5).forEach((f) => {
      leaves.push({
        id: `data-${f.id}`,
        kind: 'data',
        fileId: f.id,
        title: clip(f.name, 20),
        subtitle: f.tableName ? 'Data table' : 'Document',
        w: 128,
        h: 44,
      });
    });
    if (mod.stellaFiles.length > 5) {
      leaves.push({
        id: `${mod.id}-more-data`,
        kind: 'leaf',
        title: `+${mod.stellaFiles.length - 5} more`,
        subtitle: 'Data files',
        w: 128,
        h: 44,
      });
    }
    if (mod.memory.length) {
      leaves.push({
        id: `${mod.id}-mem`,
        kind: 'memory',
        title: 'Chat memory',
        subtitle: `${mod.memory.length} fact${mod.memory.length === 1 ? '' : 's'}`,
        w: 128,
        h: 44,
      });
    }
    if (!leaves.length) {
      leaves.push({
        id: `${mod.id}-empty`,
        kind: 'empty',
        title: 'Nothing yet',
        subtitle: 'Upload in settings',
        w: 128,
        h: 44,
      });
    }

    const spread = Math.min(1.15, 0.28 * Math.max(leaves.length, 1));
    fanAngles(mod.angle, leaves.length, spread).forEach((ang, i) => {
      const lp = polar(p.x, p.y, leafR, ang);
      const leaf = clampNode({ ...leaves[i], x: lp.x, y: lp.y, moduleId: mod.id });
      nodes.push(leaf);
      edges.push({ from: mod.id, to: leaf.id, kind: 'leaf' });
    });
  }

  for (const c of model.connections || []) {
    edges.push({ from: c.a, to: c.b, kind: 'share', label: 'sharing context' });
  }

  const stella = model.modules.find((m) => m.id === 'stella');
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const j of stella?.joins || []) {
    const a = `data-${j.fromId}`;
    const b = `data-${j.toId}`;
    if (!nodeIds.has(a) || !nodeIds.has(b)) continue;
    edges.push({ from: a, to: b, kind: 'join', label: j.label });
  }

  return { nodes, edges };
}

function usedWhenChatting(model, moduleId) {
  const mod = model.modules.find((m) => m.id === moduleId);
  if (!mod) return [];
  const parts = ['Account settings (company, role, definitions)'];
  if (model.generalMemory.length) parts.push(`${model.generalMemory.length} general remembered fact${model.generalMemory.length === 1 ? '' : 's'}`);
  if (mod.memory.length) parts.push(`${mod.memory.length} ${mod.short} remembered fact${mod.memory.length === 1 ? '' : 's'}`);
  if (mod.files.length) parts.push(`${mod.files.length} context file${mod.files.length === 1 ? '' : 's'} in this module`);
  if (mod.pptx) parts.push('PowerPoint template (export style only)');
  if (mod.goals) parts.push('Stella analysis goals');
  if (mod.stellaFiles.length) parts.push(`${mod.stellaFiles.length} data file${mod.stellaFiles.length === 1 ? '' : 's'} and intake notes`);
  if (mod.joins.length) parts.push(`${mod.joins.length} stored join${mod.joins.length === 1 ? '' : 's'} between files`);
  for (const id of mod.linked) {
    const other = model.modules.find((m) => m.id === id);
    if (!other) continue;
    const bits = [];
    if (other.files.length) bits.push(`${other.files.length} file${other.files.length === 1 ? '' : 's'}`);
    if (other.stellaFiles.length) bits.push(`${other.stellaFiles.length} dataset${other.stellaFiles.length === 1 ? '' : 's'}`);
    if (other.memory.length) bits.push(`${other.memory.length} remembered fact${other.memory.length === 1 ? '' : 's'}`);
    parts.push(`Shared from ${other.title}${bits.length ? ` (${bits.join(', ')})` : ''}`);
  }
  return parts;
}

export default function ContextMap({ userSettings, stellaDataFiles = [], onOpenPane }) {
  const [selected, setSelected] = useState('account');
  const [openFileId, setOpenFileId] = useState('');

  const model = useMemo(() => {
    const connections = Array.isArray(userSettings?.moduleConnections) ? userSettings.moduleConnections : [];
    const accountFields = filledAccountFields(userSettings);
    const generalMemory = memoryFor(userSettings, '');
    const stellaFiles = (stellaDataFiles || []).filter((f) => f && !f.processing);
    const joins = stellaJoinEdges(stellaFiles);
    const modules = MODULES.map((mod) => {
      const files = (userSettings?.moduleContext?.[mod.id]?.files || []).filter((f) => f && !f.processing);
      const linked = connectedModuleIds(connections, mod.id);
      return {
        ...mod,
        files: files.map(contextFileSummary),
        memory: memoryFor(userSettings, mod.id),
        linked,
        pptx: mod.id === 'incentives' ? userSettings?.pptxTemplate : null,
        goals: mod.id === 'stella' ? String(userSettings?.stellaBusinessContext?.keyGoals || '').trim() : '',
        stellaFiles: mod.id === 'stella' ? stellaFiles.map(stellaFileSummary) : [],
        joins: mod.id === 'stella' ? joins : [],
      };
    });
    return { connections, accountFields, generalMemory, modules };
  }, [userSettings, stellaDataFiles]);

  const graph = useMemo(() => layoutStar(model), [model]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const hub = byId.get('account') || { x: CANVAS.cx, y: CANVAS.cy };

  const selectedModule = model.modules.find((m) => m.id === selected) || null;
  const selectedIsAccount = selected === 'account' || selected === 'account-settings' || selected === 'account-memory';

  const selectNode = (node) => {
    if (!node) return;
    if (node.id === 'account' || node.kind === 'hub-leaf' || node.id === 'account-memory') {
      setSelected('account');
      setOpenFileId('');
      return;
    }
    if (node.moduleId && MODULES.some((m) => m.id === node.moduleId)) {
      setSelected(node.moduleId);
      setOpenFileId(node.fileId || '');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" /> Context map
        </h3>
        <p className="text-xs text-blue-300/70 leading-relaxed">
          Star schema of this account: the centre is always available to every tool. Modules sit around it with their
          own files and memory. A cyan link between modules means they share context; otherwise they stay separate.
        </p>
      </div>

      <div className="bg-slate-950/50 border border-blue-400/20 rounded-xl overflow-hidden">
        <div className="relative w-full" style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}>
          <svg
            viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
            className="absolute inset-0 w-full h-full"
            role="img"
            aria-label="Star schema of captured context"
          >
            <defs>
              <radialGradient id="ctx-hub-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(139,92,246,0.18)" />
                <stop offset="100%" stopColor="rgba(139,92,246,0)" />
              </radialGradient>
            </defs>
            <circle cx={CANVAS.cx} cy={CANVAS.cy} r="168" fill="url(#ctx-hub-glow)" />
            {graph.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const path = edgePath(a, b, e.kind, hub);
              const stroke = e.kind === 'share' || e.kind === 'join'
                ? 'rgba(34,211,238,0.85)'
                : e.kind === 'spoke'
                  ? 'rgba(167,139,250,0.75)'
                  : 'rgba(148,163,184,0.45)';
              const width = e.kind === 'share' ? 3.2 : e.kind === 'join' ? 2.2 : e.kind === 'spoke' ? 2.4 : 1.4;
              const dash = e.kind === 'join' ? '7 5' : e.kind === 'leaf' ? '4 4' : undefined;
              const related = selected === e.from || selected === e.to
                || (selectedModule && (e.from === selectedModule.id || e.to === selectedModule.id))
                || (selectedIsAccount && (e.from === 'account' || e.to === 'account'));
              return (
                <g key={`${e.kind}|${e.from}|${e.to}|${e.label || ''}`}>
                  <path
                    d={path.d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={width}
                    strokeDasharray={dash}
                    strokeLinecap="round"
                    opacity={related ? 1 : 0.55}
                  />
                  {e.label ? (
                    <text
                      x={path.labelX}
                      y={path.labelY - 6}
                      textAnchor="middle"
                      fill={e.kind === 'spoke' ? '#c4b5fd' : '#a5f3fc'}
                      fontSize="10"
                      fontWeight="600"
                    >
                      {e.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const isOpenFile = !!(node.fileId && node.fileId === openFileId);
            const on = selected === node.id
              || (selectedIsAccount && (node.kind === 'hub' || node.moduleId === 'account'))
              || (selectedModule && (node.id === selectedModule.id || node.moduleId === selectedModule.id));
            const mod = MODULES.find((m) => m.id === node.moduleId) || MODULES.find((m) => m.id === node.id);
            const Icon = node.kind === 'hub' ? UserCog : (mod?.Icon || FileText);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => selectNode(node)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-xl border shadow-lg transition-all ${
                  node.kind === 'hub'
                    ? 'bg-violet-600/90 border-violet-200/40 text-white'
                    : node.kind === 'module'
                      ? 'bg-slate-900/95 border-white/20 text-white'
                      : node.kind === 'data'
                        ? 'bg-slate-900/90 border-cyan-400/35 text-slate-100'
                        : node.kind === 'memory'
                          ? 'bg-slate-900/90 border-violet-400/35 text-slate-100'
                          : node.kind === 'empty'
                            ? 'bg-slate-900/60 border-slate-600/40 text-slate-400'
                            : 'bg-slate-900/90 border-blue-400/25 text-slate-100'
                } ${isOpenFile ? 'ring-2 ring-cyan-300 z-20' : on ? 'ring-2 ring-white/60 z-20' : 'z-10 hover:ring-1 hover:ring-cyan-300/50'}`}
                style={{
                  left: `${(node.x / CANVAS.w) * 100}%`,
                  top: `${(node.y / CANVAS.h) * 100}%`,
                  width: `${(node.w / CANVAS.w) * 100}%`,
                  minHeight: `${(node.h / CANVAS.h) * 100}%`,
                }}
              >
                <span className="flex items-start gap-1.5 px-2 py-1.5">
                  <span className={`mt-0.5 flex-shrink-0 rounded-md p-1 ${
                    node.kind === 'hub' ? 'bg-white/15' : (mod?.iconBg || 'bg-slate-700/80')
                  }`}>
                    {node.kind === 'file' || node.kind === 'data' ? (
                      <FileText className="w-3 h-3 text-white" />
                    ) : node.kind === 'memory' ? (
                      <Network className="w-3 h-3 text-white" />
                    ) : (
                      <Icon className="w-3 h-3 text-white" />
                    )}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[11px] font-bold truncate">{node.title}</span>
                    {node.subtitle ? (
                      <span className="block text-[9px] text-blue-100/70 truncate mt-0.5">{node.subtitle}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-t border-blue-400/15 text-[10px] text-blue-200/70 bg-slate-900/40">
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-violet-400 rounded" /> Always available from account</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-cyan-400 rounded" /> Modules sharing context</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-cyan-400" /> Stored file join</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-slate-400" /> Belongs to that module</span>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-blue-400/20 rounded-xl p-4 sm:p-5">
        {selectedIsAccount && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white">Account — the centre of the schema</div>
                <p className="text-[11px] text-blue-300/55 mt-1">Used in every module. No linking required.</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenPane?.('general')}
                className="text-[11px] font-semibold text-cyan-200 hover:text-white flex items-center gap-1"
              >
                Open General <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {model.accountFields.length ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {model.accountFields.map((f) => (
                  <div key={f.key} className="bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                    <dt className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold">{f.label}</dt>
                    <dd className="text-xs text-slate-200 mt-1 whitespace-pre-wrap">{clip(f.value, 280)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-blue-300/45">Fill in company, role, and definitions under General so every chat starts with the same background.</p>
            )}
            <div>
              <div className="text-xs font-semibold text-blue-200 mb-2">Remembered from chats (not tied to a module)</div>
              {model.generalMemory.length ? (
                <ul className="space-y-1.5">
                  {model.generalMemory.slice(0, 8).map((m) => (
                    <li key={m.id} className="text-xs text-slate-200 bg-slate-900/40 border border-blue-400/10 rounded-lg px-3 py-2">{m.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-blue-300/45">No untagged facts. Facts harvested in a module sit on that module’s arm of the star.</p>
              )}
            </div>
          </div>
        )}

        {selectedModule && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white">{selectedModule.title}</div>
                <p className="text-[11px] text-blue-300/55 mt-1">
                  {selectedModule.linked.length
                    ? `Cyan link: shares context with ${selectedModule.linked.map((id) => MODULE_CONTEXT_LABELS[id]).join(' and ')}.`
                    : 'No cyan link — other modules do not receive these files unless you connect them on the home page.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenPane?.(selectedModule.pane, selectedModule.id === 'stella' ? { stellaTab: 'connections' } : undefined)}
                className="text-[11px] font-semibold text-cyan-200 hover:text-white flex items-center gap-1"
              >
                Open settings <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-slate-900/40 border border-cyan-400/15 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wide text-cyan-300/70 font-semibold mb-2">Used when you chat here</div>
              <ul className="space-y-1">
                {usedWhenChatting(model, selectedModule.id).map((line) => (
                  <li key={line} className="text-xs text-slate-200 flex items-start gap-2">
                    <span className="text-cyan-400 mt-0.5">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            {selectedModule.pptx && (
              <div className="bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold">PowerPoint template</div>
                <div className="text-xs text-slate-200 mt-1">{selectedModule.pptx.fileName || 'Custom template'} — colours and fonts for Incentive exports, not chat context.</div>
              </div>
            )}

            {selectedModule.goals && (
              <div className="bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold">Analysis goals</div>
                <div className="text-xs text-slate-200 mt-1 whitespace-pre-wrap">{clip(selectedModule.goals, 400)}</div>
              </div>
            )}

            {selectedModule.stellaFiles.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-blue-200 mb-2">Data files (intake stays on the file)</div>
                <div className="space-y-2">
                  {selectedModule.stellaFiles.map((f) => {
                    const open = openFileId === f.id;
                    return (
                      <div key={f.id} className="bg-slate-900/40 border border-blue-400/15 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setOpenFileId(open ? '' : f.id)}
                          className="w-full text-left px-3 py-2 flex items-start justify-between gap-2"
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-white truncate">{f.name}</span>
                            <span className="block text-[10px] text-blue-300/50 mt-0.5">
                              {f.tableName ? `Table ${f.tableName}` : 'Document'}
                              {f.rowCount != null ? ` · ${f.rowCount} rows` : ''}
                              {f.intakeComplete ? ' · Intake captured' : ' · Intake incomplete'}
                            </span>
                          </span>
                          <ChevronRight className={`w-4 h-4 text-blue-300/50 flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                        {open && (
                          <div className="px-3 pb-3 space-y-1.5 text-[11px] text-slate-300">
                            {f.represents ? <div><span className="text-blue-300/60">Represents: </span>{f.represents}</div> : null}
                            {f.period ? <div><span className="text-blue-300/60">Period: </span>{f.period}</div> : null}
                            {f.metrics.length ? <div><span className="text-blue-300/60">Metrics: </span>{f.metrics.join(', ')}</div> : null}
                            {f.maps.length ? <div><span className="text-blue-300/60">Name maps: </span>{f.maps.join('; ')}</div> : null}
                            {f.qaCount ? <div>{f.qaCount} intake answer{f.qaCount === 1 ? '' : 's'} stored on this file</div> : null}
                            {!f.represents && !f.period && !f.metrics.length && !f.maps.length && !f.qaCount && (
                              <div className="text-blue-300/45">No interpretive notes yet — finish intake on Connections.</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedModule.joins.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-blue-200 mb-2">How those files join</div>
                <ul className="space-y-1.5">
                  {selectedModule.joins.map((e) => (
                    <li key={`${e.fromId}|${e.toId}|${e.label}`} className="text-xs text-slate-200 bg-slate-900/40 border border-cyan-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
                      <span><span className="font-semibold">{e.fromName}</span> {e.label} <span className="font-semibold">{e.toName}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedModule.files.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-blue-200 mb-2">Context files</div>
                <div className="space-y-2">
                  {selectedModule.files.map((f) => {
                    const open = openFileId === f.id;
                    return (
                      <div key={f.id} className="bg-slate-900/40 border border-blue-400/15 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setOpenFileId(open ? '' : f.id)}
                          className="w-full text-left px-3 py-2 flex items-start justify-between gap-2"
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-white truncate flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" /> {f.name}
                            </span>
                            <span className="block text-[10px] text-blue-300/50 mt-0.5">
                              {f.kind} · {f.blockCount ? `${f.blockCount} captured field${f.blockCount === 1 ? '' : 's'}` : 'No extracted fields yet'}
                            </span>
                          </span>
                          <ChevronRight className={`w-4 h-4 text-blue-300/50 flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                        {open && f.highlights.length > 0 && (
                          <ul className="px-3 pb-3 space-y-1">
                            {f.highlights.map((h, i) => (
                              <li key={`${f.id}-h-${i}`} className="text-[11px] text-slate-300">• {h}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-blue-200 mb-2">Chat memory tagged to this module</div>
              {selectedModule.memory.length ? (
                <ul className="space-y-1.5">
                  {selectedModule.memory.slice(0, 8).map((m) => (
                    <li key={m.id} className="text-xs text-slate-200 bg-slate-900/40 border border-blue-400/10 rounded-lg px-3 py-2">{m.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-blue-300/45">No remembered facts from chats in this module. File intake is not stored here.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
