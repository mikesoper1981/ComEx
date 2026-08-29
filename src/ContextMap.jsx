import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  DollarSign,
  FileText,
  Files,
  Layers,
  Link2,
  Map as MapIcon,
  Network,
  Table2,
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

const FILE_KINDS = [
  { id: 'spreadsheet', title: 'Spreadsheet', subtitle: 'Excel / CSV', match: (f) => kindOfFile(f) === 'spreadsheet' },
  { id: 'powerpoint', title: 'PowerPoint', subtitle: 'Strategy decks', match: (f) => kindOfFile(f) === 'powerpoint' },
  { id: 'pdf', title: 'PDF', subtitle: 'Documents', match: (f) => kindOfFile(f) === 'pdf' },
  { id: 'document', title: 'Other files', subtitle: 'Text / other', match: (f) => kindOfFile(f) === 'document' },
];

const CANVAS = { w: 1200, h: 860, cx: 600, cy: 400, moduleR: 250, leafR: 150 };

const EMPTY_FOCUS = { moduleId: '', group: '', kind: '', fileId: '' };

function clip(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function isPptxLike(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.kind || file?.fileType || file?.type || file?.kindLabel || '').toLowerCase();
  return /\.pptx?$/.test(name) || /ppt|presentation/.test(type) || !!file?.isPptx;
}

function contextFileKindLabel(file) {
  if (isPptxLike(file)) return 'PowerPoint / strategy';
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.kind || file?.fileType || '').toLowerCase();
  if (/\.pdf$/.test(name) || type.includes('pdf')) return 'PDF';
  if (/\.(xlsx?|csv)$/.test(name) || /excel|spreadsheet|csv/.test(type)) return 'Spreadsheet';
  return file?.fileType || 'Context file';
}

function kindOfFile(file) {
  if (isPptxLike(file)) return 'powerpoint';
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.kind || file?.fileType || file?.kindLabel || '').toLowerCase();
  if (/\.pdf$/.test(name) || type.includes('pdf')) return 'pdf';
  if (/\.(xlsx?|csv)$/.test(name) || /excel|spreadsheet|csv/.test(type) || file?.tableName) return 'spreadsheet';
  return 'document';
}

function filledAccountFields(settings) {
  return ACCOUNT_FIELDS
    .map(([key, label]) => ({ key, label, value: String(settings?.[key] || '').trim() }))
    .filter((f) => f.value);
}

function contextFileSummary(file) {
  const blocks = listModuleContextBlocks(file) || [];
  const highlights = blocks
    .map((b) => {
      if (b.qa) return clip(b.answer || b.question, 160);
      return clip(b.value, 160);
    })
    .filter(Boolean);
  return {
    id: file.id,
    name: file.name || 'File',
    kind: file.fileType || 'file',
    kindLabel: contextFileKindLabel(file),
    intakeComplete: !!file.intakeComplete,
    processing: !!file.processing,
    highlights,
    blockCount: blocks.length,
    source: 'context',
    nodeId: `ctx-${file.id}`,
  };
}

function stellaFileSummary(file) {
  const ctx = file?.capturedContext && typeof file.capturedContext === 'object' ? file.capturedContext : {};
  const maps = Array.isArray(ctx.name_maps) ? ctx.name_maps.filter((m) => m?.from && m?.to) : [];
  const qa = Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs.filter((p) => p && (p.question || p.answer)) : [];
  const rels = Array.isArray(ctx.relationships) ? ctx.relationships.filter((r) => r && (r.this_field || r.related_file || r.related_table)) : [];
  const pptx = isPptxLike(file);
  const highlights = [
    clip(file?.summary, 160),
    clip(ctx.what_it_represents, 160),
    clip(ctx.interpretation_notes, 160),
    clip(file?.extractedText || file?.structuredExtract || file?.visionExtract, 160),
    ...(Array.isArray(ctx.key_metrics) ? ctx.key_metrics : []).map((m) => clip(m, 120)),
    ...qa.map((p) => clip(p.answer || p.question, 160)),
  ].filter(Boolean);
  return {
    id: file.id,
    name: file.name || 'File',
    tableName: file.tableName || '',
    rowCount: file.rowCount,
    intakeComplete: !!(file.intakeComplete || file.capturedContext),
    represents: clip(ctx.what_it_represents, 160),
    period: clip(ctx.time_period, 80),
    metrics: (Array.isArray(ctx.key_metrics) ? ctx.key_metrics : []).map((m) => String(m || '').trim()).filter(Boolean),
    maps: maps.map((m) => `${m.from} → ${m.to}`),
    qaCount: qa.length,
    joinCount: rels.length,
    isPptx: pptx,
    kindLabel: pptx ? 'PowerPoint / strategy' : (file.tableName ? 'Data table' : 'Document'),
    highlights,
    source: 'stella',
    nodeId: `data-${file.id}`,
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

function moduleFiles(mod) {
  return [...(mod.files || []), ...(mod.stellaFiles || [])];
}

function groupsFor(mod, generalMemory) {
  const files = moduleFiles(mod);
  const tagged = mod.memory || [];
  const groups = [];
  groups.push({
    id: 'memory',
    title: 'Chat memory',
    subtitle: tagged.length
      ? `${tagged.length} tagged to ${mod.short}`
      : (generalMemory.length ? `${generalMemory.length} passed from centre` : 'None yet'),
    count: tagged.length + generalMemory.length,
    kind: 'memory',
  });
  if (files.length) {
    groups.push({
      id: 'files',
      title: 'Files',
      subtitle: `${files.length} file${files.length === 1 ? '' : 's'}`,
      count: files.length,
      kind: 'files',
    });
  }
  if (mod.pptx) {
    groups.push({
      id: 'pptx-template',
      title: 'PPT export template',
      subtitle: clip(mod.pptx.fileName || 'Custom', 22),
      count: 1,
      kind: 'leaf',
    });
  }
  if (mod.goals) {
    groups.push({
      id: 'goals',
      title: 'Analysis goals',
      subtitle: clip(mod.goals, 22),
      count: 1,
      kind: 'leaf',
    });
  }
  return groups;
}

function kindsFor(mod) {
  const files = moduleFiles(mod);
  return FILE_KINDS
    .map((k) => ({ ...k, files: files.filter(k.match) }))
    .filter((k) => k.files.length);
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
    const bump = kind === 'share' ? 56 : 36;
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

function placeLeaves(nodes, edges, parentId, parent, leaves, angle) {
  if (!leaves.length) return;
  const spread = Math.min(1.5, 0.32 * Math.max(leaves.length, 1));
  const dist = CANVAS.leafR + Math.min(48, Math.max(0, leaves.length - 3) * 8);
  fanAngles(angle, leaves.length, spread).forEach((ang, i) => {
    const lp = polar(parent.x, parent.y, dist, ang);
    const leaf = clampNode({ ...leaves[i], x: lp.x, y: lp.y, moduleId: parent.moduleId || parent.id });
    nodes.push(leaf);
    edges.push({ from: parentId, to: leaf.id, kind: 'leaf' });
  });
}

function layoutStar(model, focus) {
  const nodes = [];
  const edges = [];
  const { cx, cy, moduleR } = CANVAS;

  nodes.push(clampNode({
    id: 'account',
    kind: 'hub',
    x: cx,
    y: cy,
    w: 260,
    h: 118,
    title: model.hubTitle || 'You',
    subtitle: model.hubSubtitle || 'No company set',
    caption: 'Context map passed to AI',
  }));

  for (const mod of model.modules) {
    const p = polar(cx, cy, moduleR, mod.angle);
    const groups = groupsFor(mod, model.generalMemory);
    const files = moduleFiles(mod);
    nodes.push(clampNode({
      id: mod.id,
      kind: 'module',
      moduleId: mod.id,
      x: p.x,
      y: p.y,
      w: 168,
      h: 78,
      title: mod.short,
      subtitle: focus.moduleId === mod.id
        ? 'Click a type to expand'
        : `${files.length} file${files.length === 1 ? '' : 's'} · ${mod.memory.length} tagged fact${mod.memory.length === 1 ? '' : 's'}`,
      fill: mod.fill,
    }));
    edges.push({ from: 'account', to: mod.id, kind: 'spoke' });

    if (focus.moduleId !== mod.id) continue;

    const parent = { x: p.x, y: p.y, id: mod.id, moduleId: mod.id };

    if (!focus.group) {
      placeLeaves(nodes, edges, mod.id, parent, groups.map((g) => ({
        id: `${mod.id}-grp-${g.id}`,
        kind: g.kind === 'memory' ? 'memory' : (g.kind === 'files' ? 'files' : 'leaf'),
        groupId: g.id,
        title: g.title,
        subtitle: g.subtitle,
        w: 148,
        h: 52,
      })), mod.angle);
      continue;
    }

    if (focus.group === 'memory') {
      const tagged = mod.memory || [];
      const centre = model.generalMemory || [];
      const facts = [
        ...tagged.map((m) => ({ ...m, origin: 'tagged' })),
        ...centre.map((m) => ({ ...m, origin: 'centre' })),
      ].slice(0, 10);
      const cards = facts.length
        ? facts.map((m) => ({
            id: `${mod.id}-fact-${m.id}`,
            kind: 'memory',
            groupId: 'memory',
            title: clip(m.text, 28),
            subtitle: m.origin === 'centre' ? 'From centre (always passed)' : `Tagged to ${mod.short}`,
            w: 150,
            h: 50,
          }))
        : [{
            id: `${mod.id}-mem-empty`,
            kind: 'empty',
            groupId: 'memory',
            title: 'No chat memory yet',
            subtitle: 'Facts appear after you confirm them',
            w: 160,
            h: 52,
          }];
      placeLeaves(nodes, edges, mod.id, parent, cards, mod.angle);
      continue;
    }

    if (focus.group === 'pptx-template' && mod.pptx) {
      placeLeaves(nodes, edges, mod.id, parent, [{
        id: `${mod.id}-pptx`,
        kind: 'pptx',
        groupId: 'pptx-template',
        title: 'PPT export template',
        subtitle: clip(mod.pptx.fileName || 'Custom', 22),
        w: 150,
        h: 50,
      }], mod.angle);
      continue;
    }

    if (focus.group === 'goals' && mod.goals) {
      placeLeaves(nodes, edges, mod.id, parent, [{
        id: `${mod.id}-goals`,
        kind: 'leaf',
        groupId: 'goals',
        title: 'Analysis goals',
        subtitle: clip(mod.goals, 28),
        w: 150,
        h: 50,
      }], mod.angle);
      continue;
    }

    if (focus.group === 'files' && !focus.kind) {
      placeLeaves(nodes, edges, mod.id, parent, kindsFor(mod).map((k) => ({
        id: `${mod.id}-kind-${k.id}`,
        kind: k.id === 'spreadsheet' ? 'data' : (k.id === 'powerpoint' ? 'pptx' : 'file'),
        groupId: 'files',
        kindKey: k.id,
        title: k.title,
        subtitle: `${k.files.length} file${k.files.length === 1 ? '' : 's'}`,
        w: 148,
        h: 52,
      })), mod.angle);
      continue;
    }

    if (focus.group === 'files' && focus.kind) {
      const kind = FILE_KINDS.find((k) => k.id === focus.kind);
      const list = kind ? moduleFiles(mod).filter(kind.match) : [];
      placeLeaves(nodes, edges, mod.id, parent, list.map((f) => ({
        id: f.nodeId,
        kind: kindOfFile(f) === 'powerpoint' ? 'pptx' : (kindOfFile(f) === 'spreadsheet' ? 'data' : 'file'),
        groupId: 'files',
        kindKey: focus.kind,
        fileId: f.id,
        title: clip(f.name, 22),
        subtitle: f.kindLabel || kind?.title || 'File',
        w: 150,
        h: 52,
      })), mod.angle);
    }
  }

  for (const c of model.connections || []) {
    edges.push({ from: c.a, to: c.b, kind: 'share', label: 'sharing context' });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const stella = model.modules.find((m) => m.id === 'stella');
  if (focus.moduleId === 'stella' && focus.group === 'files' && focus.kind) {
    for (const j of stella?.joins || []) {
      const a = `data-${j.fromId}`;
      const b = `data-${j.toId}`;
      if (!nodeIds.has(a) || !nodeIds.has(b)) continue;
      edges.push({ from: a, to: b, kind: 'join', label: j.label });
    }
  }

  return { nodes, edges };
}

function usedWhenChatting(model, moduleId) {
  const mod = model.modules.find((m) => m.id === moduleId);
  if (!mod) return [];
  const parts = [`Centre context for ${model.hubTitle}${model.hubSubtitle ? ` · ${model.hubSubtitle}` : ''} (always passed to the AI)`];
  if (model.generalMemory.length) parts.push(`${model.generalMemory.length} remembered fact${model.generalMemory.length === 1 ? '' : 's'} from the centre`);
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

function nodeIcon(node, mod) {
  if (node.kind === 'hub') return UserCog;
  if (node.kind === 'files' || (node.groupId === 'files' && !node.kindKey && !node.fileId)) return Files;
  if (node.kindKey === 'spreadsheet' || node.kind === 'data') return Table2;
  if (node.kind === 'file' || node.kind === 'pptx' || node.fileId) return FileText;
  if (node.kind === 'memory') return Network;
  return mod?.Icon || FileText;
}

export default function ContextMap({
  userSettings,
  stellaDataFiles = [],
  userName = '',
  companyName = '',
  layout = null,
  onLayoutChange,
  onOpenPane,
}) {
  const [selected, setSelected] = useState('account');
  const [focus, setFocus] = useState(EMPTY_FOCUS);
  const [openFileId, setOpenFileId] = useState('');
  const [livePos, setLivePos] = useState({});
  const dragRef = useRef(null);
  const skipClickRef = useRef(false);
  const canvasRef = useRef(null);

  const model = useMemo(() => {
    const connections = Array.isArray(userSettings?.moduleConnections) ? userSettings.moduleConnections : [];
    const accountFields = filledAccountFields(userSettings);
    const generalMemory = memoryFor(userSettings, '');
    const stellaFiles = (stellaDataFiles || []).filter((f) => f && !f.processing);
    const joins = stellaJoinEdges(stellaFiles);
    const name = String(userName || '').trim() || 'You';
    const company = String(companyName || '').trim();
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
    return {
      connections,
      accountFields,
      generalMemory,
      modules,
      hubTitle: name,
      hubSubtitle: company || 'No company set',
    };
  }, [userSettings, stellaDataFiles, userName, companyName]);

  const graph = useMemo(() => {
    const laid = layoutStar(model, focus);
    const saved = layout?.nodes && typeof layout.nodes === 'object' ? layout.nodes : {};
    const nodes = laid.nodes.map((n) => {
      const s = saved[n.id];
      const live = livePos[n.id];
      let next = { ...n };
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
        next.x = s.x * CANVAS.w;
        next.y = s.y * CANVAS.h;
        if (s.w) next.w = Math.max(88, s.w * CANVAS.w);
        if (s.h) next.h = Math.max(40, s.h * CANVAS.h);
      }
      if (live) next = { ...next, ...live };
      return clampNode(next);
    });
    return { nodes, edges: laid.edges };
  }, [model, layout, livePos, focus]);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const hub = byId.get('account') || { x: CANVAS.cx, y: CANVAS.cy };

  const persistLayout = (nodes) => {
    if (!onLayoutChange) return;
    const next = { nodes: {} };
    for (const n of nodes) {
      next.nodes[n.id] = {
        x: n.x / CANVAS.w,
        y: n.y / CANVAS.h,
        w: n.w / CANVAS.w,
        h: n.h / CANVAS.h,
      };
    }
    onLayoutChange(next);
  };

  const clientToCanvas = (clientX, clientY) => {
    const el = canvasRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: ((clientX - r.left) / r.width) * CANVAS.w,
      y: ((clientY - r.top) / r.height) * CANVAS.h,
    };
  };

  const selectNode = (node) => {
    if (!node) return;
    if (node.kind === 'hub' || node.id === 'account') {
      setSelected('account');
      setFocus(EMPTY_FOCUS);
      setOpenFileId('');
      return;
    }
    if (node.kind === 'module') {
      setSelected(node.id);
      setFocus({ moduleId: node.id, group: '', kind: '', fileId: '' });
      setOpenFileId('');
      return;
    }
    if (node.fileId) {
      setSelected(node.moduleId);
      setFocus({
        moduleId: node.moduleId,
        group: node.groupId || 'files',
        kind: node.kindKey || focus.kind || '',
        fileId: node.fileId,
      });
      setOpenFileId(node.fileId);
      return;
    }
    if (node.kindKey) {
      setSelected(node.moduleId);
      setFocus({ moduleId: node.moduleId, group: 'files', kind: node.kindKey, fileId: '' });
      setOpenFileId('');
      return;
    }
    if (node.groupId) {
      setSelected(node.moduleId);
      setFocus({ moduleId: node.moduleId, group: node.groupId, kind: '', fileId: '' });
      setOpenFileId('');
    }
  };

  const onNodePointerDown = (ev, node, mode = 'move') => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const loc = clientToCanvas(ev.clientX, ev.clientY);
    dragRef.current = {
      id: node.id,
      mode,
      moved: false,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origin: { x: node.x, y: node.y, w: node.w, h: node.h },
      grab: loc,
    };
    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    selectNode(node);
  };

  useEffect(() => {
    const onMove = (ev) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dist = Math.hypot(ev.clientX - drag.startClientX, ev.clientY - drag.startClientY);
      if (dist > 4) drag.moved = true;
      const loc = clientToCanvas(ev.clientX, ev.clientY);
      if (!loc || !drag.grab) return;
      if (drag.mode === 'resize') {
        const w = Math.max(88, drag.origin.w + (loc.x - drag.grab.x));
        const h = Math.max(40, drag.origin.h + (loc.y - drag.grab.y));
        setLivePos((prev) => ({ ...prev, [drag.id]: { ...(prev[drag.id] || {}), w, h } }));
        return;
      }
      const x = drag.origin.x + (loc.x - drag.grab.x);
      const y = drag.origin.y + (loc.y - drag.grab.y);
      setLivePos((prev) => ({ ...prev, [drag.id]: { ...(prev[drag.id] || {}), x, y } }));
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.moved) return;
      skipClickRef.current = true;
      setLivePos((current) => {
        const merged = graph.nodes.map((n) => (current[n.id] ? clampNode({ ...n, ...current[n.id] }) : n));
        persistLayout(merged);
        return {};
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [graph.nodes]);

  const resetLayout = () => {
    setLivePos({});
    onLayoutChange?.({ nodes: {} });
  };

  const selectedModule = model.modules.find((m) => m.id === selected) || null;
  const selectedIsAccount = selected === 'account';
  const focusedFile = selectedModule
    ? moduleFiles(selectedModule).find((f) => f.id === (focus.fileId || openFileId))
    : null;
  const breadcrumb = (() => {
    if (!selectedModule) return [];
    const bits = [selectedModule.short];
    if (focus.group === 'memory') bits.push('Chat memory');
    if (focus.group === 'files') bits.push('Files');
    if (focus.kind) bits.push(FILE_KINDS.find((k) => k.id === focus.kind)?.title || focus.kind);
    if (focusedFile) bits.push(focusedFile.name);
    if (focus.group === 'pptx-template') bits.push('PPT export template');
    if (focus.group === 'goals') bits.push('Analysis goals');
    return bits;
  })();

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" /> Context map
        </h3>
        <p className="text-xs text-blue-300/70 leading-relaxed">
          Click a module to expand types, then files. Drag any card to rearrange; pull the corner to resize.
          The centre is always sent to the AI. Cyan links mean modules share context.
        </p>
      </div>

      <div className="bg-slate-950/50 border border-blue-400/20 rounded-xl overflow-hidden">
        <div ref={canvasRef} className="relative w-full" style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}>
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
              <filter id="ctx-label-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#020617" floodOpacity="0.9" />
              </filter>
            </defs>
            <circle cx={CANVAS.cx} cy={CANVAS.cy} r="168" fill="url(#ctx-hub-glow)" />
            {graph.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const path = edgePath(a, b, e.kind, hub);
              const stroke = e.kind === 'share' || e.kind === 'join'
                ? 'rgba(34,211,238,0.9)'
                : e.kind === 'spoke'
                  ? 'rgba(167,139,250,0.75)'
                  : 'rgba(148,163,184,0.45)';
              const width = e.kind === 'share' ? 3.2 : e.kind === 'join' ? 2.4 : e.kind === 'spoke' ? 2.4 : 1.4;
              const dash = e.kind === 'join' ? '7 5' : e.kind === 'leaf' ? '4 4' : undefined;
              const related = selected === e.from || selected === e.to
                || (selectedModule && (e.from === selectedModule.id || e.to === selectedModule.id))
                || (selectedIsAccount && (e.from === 'account' || e.to === 'account'));
              const labelW = e.label ? Math.max(48, e.label.length * 6.6 + 16) : 0;
              const labelH = 18;
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
                    <g filter="url(#ctx-label-shadow)">
                      <rect
                        x={path.labelX - labelW / 2}
                        y={path.labelY - labelH - 2}
                        width={labelW}
                        height={labelH}
                        rx="5"
                        fill={e.kind === 'join' ? 'rgba(8,47,73,0.96)' : 'rgba(15,23,42,0.94)'}
                        stroke={e.kind === 'join' ? 'rgba(103,232,249,0.7)' : 'rgba(196,181,253,0.45)'}
                        strokeWidth="1"
                      />
                      <text
                        x={path.labelX}
                        y={path.labelY - 6}
                        textAnchor="middle"
                        fill={e.kind === 'join' ? '#ecfeff' : '#ede9fe'}
                        fontSize="11"
                        fontWeight="700"
                      >
                        {e.label}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {graph.nodes.map((node) => {
            const isOpenFile = !!(node.fileId && node.fileId === openFileId);
            const on = selected === node.id
              || node.id === focus.moduleId
              || (node.groupId && node.groupId === focus.group && !node.kindKey && !node.fileId)
              || (node.kindKey && node.kindKey === focus.kind && !node.fileId)
              || isOpenFile
              || (selectedIsAccount && node.kind === 'hub');
            const mod = MODULES.find((m) => m.id === node.moduleId) || MODULES.find((m) => m.id === node.id);
            const Icon = nodeIcon(node, mod);
            return (
              <button
                key={node.id}
                type="button"
                onPointerDown={(ev) => onNodePointerDown(ev, node, 'move')}
                onClick={() => {
                  if (skipClickRef.current) {
                    skipClickRef.current = false;
                    return;
                  }
                  selectNode(node);
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-xl border shadow-lg transition-shadow cursor-grab active:cursor-grabbing touch-none ${
                  node.kind === 'hub'
                    ? 'bg-violet-600/90 border-violet-200/40 text-white'
                    : node.kind === 'module'
                      ? 'bg-slate-900/95 border-white/20 text-white'
                      : node.kind === 'data' || node.kind === 'files'
                        ? 'bg-slate-900/90 border-cyan-400/35 text-slate-100'
                        : node.kind === 'pptx'
                          ? 'bg-slate-900/90 border-amber-400/40 text-slate-100'
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
                    <Icon className="w-3 h-3 text-white" />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[11px] font-bold truncate">{node.title}</span>
                    {node.subtitle ? (
                      <span className="block text-[9px] text-blue-100/70 truncate mt-0.5">{node.subtitle}</span>
                    ) : null}
                    {node.caption ? (
                      <span className="block text-[9px] text-amber-200 font-semibold mt-0.5">{node.caption}</span>
                    ) : null}
                  </span>
                </span>
                <span
                  role="presentation"
                  onPointerDown={(ev) => onNodePointerDown(ev, node, 'resize')}
                  className="absolute right-0.5 bottom-0.5 w-3 h-3 cursor-se-resize rounded-sm border-r-2 border-b-2 border-white/50 hover:border-white"
                  title="Resize"
                />
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-t border-blue-400/15 text-[10px] text-blue-200/70 bg-slate-900/40">
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-violet-400 rounded" /> Always passed to the AI</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-cyan-400 rounded" /> Modules sharing context</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-cyan-400" /> Stored file join</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/80" /> PowerPoint / strategy</span>
          <button type="button" onClick={resetLayout} className="ml-auto text-[10px] font-semibold text-cyan-200 hover:text-white">Reset layout</button>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-blue-400/20 rounded-xl p-4 sm:p-5">
        {selectedIsAccount && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white">{model.hubTitle}{model.hubSubtitle ? ` · ${model.hubSubtitle}` : ''}</div>
                <p className="text-[11px] text-amber-200/80 mt-1 font-semibold">Context map passed to AI — used in every module, no linking required.</p>
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
              <div className="text-xs font-semibold text-blue-200 mb-2">Remembered from chats (always passed to the AI)</div>
              {model.generalMemory.length ? (
                <ul className="space-y-1.5">
                  {model.generalMemory.map((m) => (
                    <li key={m.id} className="text-xs text-slate-200 bg-slate-900/40 border border-blue-400/10 rounded-lg px-3 py-2">{m.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-blue-300/45">No untagged facts yet. Facts harvested in a module also sit on that module — click Stella or Incentives, then Chat memory.</p>
              )}
            </div>
          </div>
        )}

        {selectedModule && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white">{selectedModule.title}</div>
                {breadcrumb.length > 1 ? (
                  <p className="text-[11px] text-cyan-200/80 mt-1">{breadcrumb.join(' › ')}</p>
                ) : (
                  <p className="text-[11px] text-blue-300/55 mt-1">
                    {selectedModule.linked.length
                      ? `Cyan link: shares context with ${selectedModule.linked.map((id) => MODULE_CONTEXT_LABELS[id]).join(' and ')}.`
                      : 'No cyan link — other modules do not receive these files unless you connect them on the home page.'}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenPane?.(selectedModule.pane, selectedModule.id === 'stella' ? { stellaTab: 'connections' } : undefined)}
                className="text-[11px] font-semibold text-cyan-200 hover:text-white flex items-center gap-1"
              >
                Open settings <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!focus.group && (
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
                <p className="text-[11px] text-blue-300/50 mt-2">Click Chat memory or Files on the map to drill in.</p>
              </div>
            )}

            {focus.group === 'memory' && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-blue-200 mb-2">Tagged to {selectedModule.short}</div>
                  {selectedModule.memory.length ? (
                    <ul className="space-y-1.5">
                      {selectedModule.memory.map((m) => (
                        <li key={m.id} className="text-xs text-slate-200 bg-slate-900/40 border border-violet-400/20 rounded-lg px-3 py-2">{m.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-blue-300/45">Nothing tagged to this module yet. Confirm a remembered fact while chatting here and it will show up on this arm.</p>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-blue-200 mb-2">Always passed from the centre</div>
                  {model.generalMemory.length ? (
                    <ul className="space-y-1.5">
                      {model.generalMemory.map((m) => (
                        <li key={m.id} className="text-xs text-slate-200 bg-slate-900/40 border border-blue-400/10 rounded-lg px-3 py-2">{m.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-blue-300/45">No untagged centre facts. Those are shared with every module automatically.</p>
                  )}
                </div>
              </div>
            )}

            {focus.group === 'pptx-template' && selectedModule.pptx && (
              <div className="bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold">PowerPoint template</div>
                <div className="text-xs text-slate-200 mt-1">{selectedModule.pptx.fileName || 'Custom template'} — colours and fonts for Incentive exports, not chat context.</div>
              </div>
            )}

            {focus.group === 'goals' && selectedModule.goals && (
              <div className="bg-slate-900/40 border border-blue-400/15 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-blue-300/50 font-semibold">Analysis goals</div>
                <div className="text-xs text-slate-200 mt-1 whitespace-pre-wrap">{clip(selectedModule.goals, 400)}</div>
              </div>
            )}

            {focus.group === 'files' && !focus.kind && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-blue-200">File types — click one on the map</div>
                {kindsFor(selectedModule).map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setFocus({ moduleId: selectedModule.id, group: 'files', kind: k.id, fileId: '' })}
                    className="w-full text-left bg-slate-900/40 border border-blue-400/15 hover:border-cyan-400/40 rounded-lg px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-white">{k.title}</span>
                    <span className="block text-[10px] text-blue-300/50 mt-0.5">{k.files.length} file{k.files.length === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            )}

            {focus.group === 'files' && focus.kind && !focusedFile && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-blue-200">
                  {FILE_KINDS.find((k) => k.id === focus.kind)?.title || 'Files'} — click a file to see captured context
                </div>
                {moduleFiles(selectedModule).filter((f) => kindOfFile(f) === focus.kind).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFocus((prev) => ({ ...prev, fileId: f.id }));
                      setOpenFileId(f.id);
                    }}
                    className="w-full text-left bg-slate-900/40 border border-blue-400/15 hover:border-cyan-400/40 rounded-lg px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-white">{f.name}</span>
                    <span className="block text-[10px] text-blue-300/50 mt-0.5">{f.kindLabel}{f.tableName ? ` · ${f.tableName}` : ''}{f.rowCount != null ? ` · ${f.rowCount} rows` : ''}</span>
                  </button>
                ))}
                {selectedModule.joins.length > 0 && focus.kind === 'spreadsheet' && (
                  <div className="pt-2">
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
              </div>
            )}

            {focusedFile && (
              <div className="bg-slate-900/40 border border-cyan-400/25 rounded-lg px-3 py-3 space-y-1.5 text-[11px] text-slate-300">
                <div className="text-xs font-semibold text-white">{focusedFile.name}</div>
                <div className="text-[10px] text-blue-300/50">
                  {focusedFile.kindLabel}
                  {focusedFile.tableName ? ` · Table ${focusedFile.tableName}` : ''}
                  {focusedFile.rowCount != null ? ` · ${focusedFile.rowCount} rows` : ''}
                  {focusedFile.intakeComplete ? ' · Intake captured' : ' · Intake incomplete'}
                </div>
                {focusedFile.represents ? <div><span className="text-blue-300/60">Represents: </span>{focusedFile.represents}</div> : null}
                {focusedFile.period ? <div><span className="text-blue-300/60">Period: </span>{focusedFile.period}</div> : null}
                {focusedFile.metrics?.length ? <div><span className="text-blue-300/60">Metrics: </span>{focusedFile.metrics.join(', ')}</div> : null}
                {focusedFile.maps?.length ? <div><span className="text-blue-300/60">Name maps: </span>{focusedFile.maps.join('; ')}</div> : null}
                {focusedFile.qaCount ? <div>{focusedFile.qaCount} intake answer{focusedFile.qaCount === 1 ? '' : 's'} stored on this file</div> : null}
                {focusedFile.blockCount ? <div>{focusedFile.blockCount} captured field{focusedFile.blockCount === 1 ? '' : 's'}</div> : null}
                {(focusedFile.highlights || []).filter((h) => h !== focusedFile.represents).map((h, i) => (
                  <div key={`${focusedFile.id}-h-${i}`}>• {h}</div>
                ))}
                {!focusedFile.represents && !focusedFile.period && !(focusedFile.metrics || []).length && !(focusedFile.highlights || []).length && (
                  <div className="text-blue-300/45">No interpretive notes yet — finish intake on Connections.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
