import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  FileText,
  Files,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Network,
  Table2,
  UserCog,
  X,
} from 'lucide-react';
import { activeMemoryItems, formatMemoryStamp } from './chatMemory';
import {
  connectedModuleIds,
  listModuleContextBlocks,
  MODULE_CONTEXT_LABELS,
} from './moduleContext';

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

const KIND_META = {
  excel: { title: 'Excel', subtitle: 'Workbooks' },
  csv: { title: 'CSV', subtitle: 'Delimited tables' },
  json: { title: 'JSON', subtitle: 'Structured tables' },
  powerpoint: { title: 'PowerPoint', subtitle: 'Strategy decks' },
  pdf: { title: 'PDF', subtitle: 'Documents' },
  document: { title: 'Other files', subtitle: 'Text / other' },
};

const CANVAS = { w: 1200, h: 860, cx: 600, cy: 400, moduleR: 250, leafR: 210 };

const EMPTY_FOCUS = { moduleId: '', group: '', kind: '', fileId: '', factId: '' };

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

function kindOfFile(file) {
  if (isPptxLike(file)) return 'powerpoint';
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.kind || file?.fileType || file?.kindLabel || file?.type || '').toLowerCase();
  if (/\.pdf$/.test(name) || type.includes('pdf')) return 'pdf';
  if (/\.csv$/.test(name) || type === 'csv' || type.includes('csv')) return 'csv';
  if (/\.json$/.test(name) || type === 'json' || type.includes('json')) return 'json';
  if (file?.tableName || /\.xlsx?$/.test(name) || /excel|spreadsheet|data table/.test(type)) return 'excel';
  return 'document';
}

function kindMeta(id) {
  return KIND_META[id] || { title: id, subtitle: 'Files' };
}

function filledAccountFields(settings) {
  return ACCOUNT_FIELDS
    .map(([key, label]) => ({ key, label, value: String(settings?.[key] || '').trim() }))
    .filter((f) => f.value);
}

function previewLines(text, limit = 5) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, limit);
}

function contextFileSummary(file) {
  const blocks = listModuleContextBlocks(file) || [];
  const highlights = blocks
    .map((b) => {
      if (b.qa) return clip(b.answer || b.question, 160);
      return clip(b.value, 160);
    })
    .filter(Boolean);
  const kind = kindOfFile(file);
  return {
    id: file.id,
    name: file.name || 'File',
    kind: file.fileType || 'file',
    kindKey: kind,
    kindLabel: kindMeta(kind).title,
    intakeComplete: !!file.intakeComplete,
    processing: !!file.processing,
    highlights,
    blockCount: blocks.length,
    extractedText: file.extractedText || '',
    structuredExtract: file.structuredExtract || '',
    visionExtract: file.visionExtract || '',
    previewRows: Array.isArray(file.previewRows) ? file.previewRows : [],
    columns: Array.isArray(file.columns) ? file.columns : [],
    source: 'context',
    nodeId: `ctx-${file.id}`,
  };
}

function stellaFileSummary(file) {
  const ctx = file?.capturedContext && typeof file.capturedContext === 'object' ? file.capturedContext : {};
  const maps = Array.isArray(ctx.name_maps) ? ctx.name_maps.filter((m) => m?.from && m?.to) : [];
  const qa = Array.isArray(ctx.qa_pairs) ? ctx.qa_pairs.filter((p) => p && (p.question || p.answer)) : [];
  const rels = Array.isArray(ctx.relationships) ? ctx.relationships.filter((r) => r && (r.this_field || r.related_file || r.related_table)) : [];
  const kind = kindOfFile(file);
  const highlights = [
    clip(file?.summary, 160),
    clip(ctx.what_it_represents, 160),
    clip(ctx.interpretation_notes, 160),
    clip(file?.extractedText || file?.structuredExtract || file?.visionExtract, 160),
    ...(Array.isArray(ctx.key_metrics) ? ctx.key_metrics : []).map((m) => clip(m, 120)),
    ...qa.map((p) => clip(p.answer || p.question, 160)),
  ].filter(Boolean);
  const previewRows = Array.isArray(file.previewRows) && file.previewRows.length
    ? file.previewRows.slice(0, 3)
    : previewRowsFromColumns(file.columns, 5);
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
    isPptx: kind === 'powerpoint',
    kindKey: kind,
    kindLabel: kindMeta(kind).title,
    highlights,
    extractedText: file.extractedText || '',
    structuredExtract: file.structuredExtract || '',
    previewRows,
    columns: Array.isArray(file.columns) ? file.columns : [],
    source: 'stella',
    nodeId: `data-${file.id}`,
  };
}

function previewRowsFromColumns(columns, limit = 5) {
  const cols = Array.isArray(columns) ? columns.filter((c) => c && (c.name || c.original)) : [];
  if (!cols.length) return [];
  const n = Math.min(limit, Math.max(0, ...cols.map((c) => (Array.isArray(c.samples) ? c.samples.length : 0))));
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => {
    const row = {};
    for (const c of cols) {
      const key = c.original || c.name;
      row[key] = Array.isArray(c.samples) ? (c.samples[i] ?? '') : '';
    }
    return row;
  });
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
      subtitle: `${files.length} file${files.length === 1 ? '' : 's'}${mod.joins?.length ? ` · ${mod.joins.length} join${mod.joins.length === 1 ? '' : 's'}` : ''}`,
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
  if (mod.goalsKey && mod.goals) {
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
  const buckets = new Map();
  for (const f of files) {
    const id = kindOfFile(f);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(f);
  }
  const order = Object.keys(KIND_META);
  return [...buckets.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })
    .map(([id, list]) => ({
      id,
      title: kindMeta(id).title,
      subtitle: `${list.length} file${list.length === 1 ? '' : 's'}`,
      files: list,
    }));
}

function withMapVisuals(hubModules) {
  const list = Array.isArray(hubModules) ? hubModules.filter((m) => m && m.id) : [];
  return list.map((mod, i) => ({
    id: mod.id,
    title: mod.title || mod.id,
    short: mod.short || mod.title || mod.id,
    fill: mod.fill || '#38bdf8',
    iconBg: mod.iconBg || 'bg-slate-700/80',
    pane: mod.settingsPane || mod.pane || mod.id,
    angle: Number.isFinite(mod.angle)
      ? mod.angle
      : (-Math.PI / 2 + (2 * Math.PI * i) / Math.max(list.length, 1)),
    Icon: mod.Icon || Layers,
    pptxTemplate: !!mod.pptxTemplate,
    goalsKey: mod.goalsKey || '',
    dataFiles: !!mod.dataFiles,
  }));
}

function clampNode(n) {
  const pad = 8;
  const maxX = CANVAS.w * 1.85;
  const maxY = CANVAS.h * 1.85;
  const minX = -CANVAS.w * 0.45;
  const minY = -CANVAS.h * 0.45;
  return {
    ...n,
    x: Math.min(maxX - n.w / 2 - pad, Math.max(n.w / 2 + pad + minX, n.x)),
    y: Math.min(maxY - n.h / 2 - pad, Math.max(n.h / 2 + pad + minY, n.y)),
  };
}

function fitCamera(nodes, pad = 64) {
  if (!nodes?.length) return { k: 1, x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - (n.w || 0) / 2);
    maxX = Math.max(maxX, n.x + (n.w || 0) / 2);
    minY = Math.min(minY, n.y - (n.h || 0) / 2);
    maxY = Math.max(maxY, n.y + (n.h || 0) / 2);
  }
  const bw = Math.max(maxX - minX, 160);
  const bh = Math.max(maxY - minY, 160);
  const k = Math.min((CANVAS.w - 2 * pad) / bw, (CANVAS.h - 2 * pad) / bh, 1.2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    k,
    x: CANVAS.cx - cx * k,
    y: CANVAS.cy - cy * k,
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

function edgePath(a, b, kind, hub, offset = 0) {
  if (kind === 'share' || kind === 'join') {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const vx = mx - hub.x;
    const vy = my - hub.y;
    const len = Math.hypot(vx, vy) || 1;
    const nx = -vy / len;
    const ny = vx / len;
    const bump = (kind === 'share' ? 56 : 40) + Math.abs(offset) * 10;
    const slide = offset * 34;
    const qx = mx + (vx / len) * bump + nx * slide;
    const qy = my + (vy / len) * bump + ny * slide;
    return {
      d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`,
      labelX: (mx + qx) / 2 + nx * slide * 0.35,
      labelY: (my + qy) / 2 + ny * slide * 0.35,
    };
  }
  return {
    d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
    labelX: (a.x + b.x) / 2,
    labelY: (a.y + b.y) / 2,
  };
}

function applySavedAndLive(n, saved, livePos) {
  let next = { ...n };
  const persist = n.kind === 'hub' || n.kind === 'module';
  if (persist) {
    const s = saved?.[n.id];
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
      next.x = s.x * CANVAS.w;
      next.y = s.y * CANVAS.h;
      if (s.w) next.w = Math.max(88, s.w * CANVAS.w);
      if (s.h) next.h = Math.max(40, s.h * CANVAS.h);
    }
  }
  if (livePos?.[n.id]) next = { ...next, ...livePos[n.id] };
  return next;
}

function placeLeaves(nodes, edges, parentId, parent, leaves, fallbackAngle, saved, livePos, hub) {
  if (!leaves.length || !parent) return;
  const n = leaves.length;
  const parentHalf = Math.max(parent.w || 168, parent.h || 78) / 2;
  const leafHalf = Math.max(...leaves.map((l) => Math.max(l.w || 148, l.h || 52))) / 2;
  const dist = parentHalf + leafHalf + 88;
  const outward = hub
    ? Math.atan2(parent.y - hub.y, parent.x - hub.x)
    : fallbackAngle;
  const spread = n <= 1 ? 0 : (n <= 2 ? 1.05 : Math.min(Math.PI * 1.35, 0.62 * n));
  fanAngles(outward, n, spread).forEach((ang, i) => {
    const lp = polar(parent.x, parent.y, dist, ang);
    const leaf = applySavedAndLive({ ...leaves[i], x: lp.x, y: lp.y, moduleId: parent.moduleId || parent.id }, saved, livePos);
    nodes.push(leaf);
    edges.push({ from: parentId, to: leaf.id, kind: 'leaf' });
  });
}

function fileNodeSpec(f) {
  const kind = kindOfFile(f);
  return {
    id: f.nodeId,
    kind: kind === 'powerpoint' ? 'pptx' : (kind === 'excel' || kind === 'csv' || kind === 'json' ? 'data' : 'file'),
    groupId: 'files',
    kindKey: kind,
    fileId: f.id,
    title: clip(f.name, 22),
    subtitle: f.kindLabel || kindMeta(kind).title,
    w: 150,
    h: 52,
  };
}

function layoutStar(model, focus, saved, livePos) {
  const nodes = [];
  const edges = [];
  const { cx, cy, moduleR } = CANVAS;
  const pos = saved && typeof saved === 'object' ? saved : {};
  const live = livePos && typeof livePos === 'object' ? livePos : {};

  nodes.push(applySavedAndLive({
    id: 'account',
    kind: 'hub',
    x: cx,
    y: cy,
    w: 260,
    h: 118,
    title: model.hubTitle || 'You',
    subtitle: model.hubSubtitle || 'No company set',
    caption: 'Context map passed to AI',
  }, pos, live));
  const hubNode = nodes[0];

  for (const mod of model.modules) {
    const p = polar(cx, cy, moduleR, mod.angle);
    const groups = groupsFor(mod, model.generalMemory);
    const files = moduleFiles(mod);
    const moduleNode = applySavedAndLive({
      id: mod.id,
      kind: 'module',
      moduleId: mod.id,
      x: p.x,
      y: p.y,
      w: 168,
      h: 78,
      title: mod.short,
      subtitle: focus.moduleId === mod.id
        ? (focus.group ? 'Click to go back' : 'Click again to collapse')
        : `${files.length} file${files.length === 1 ? '' : 's'} · ${mod.memory.length} tagged fact${mod.memory.length === 1 ? '' : 's'}`,
      fill: mod.fill,
    }, pos, live);
    nodes.push(moduleNode);
    edges.push({ from: 'account', to: mod.id, kind: 'spoke' });

    if (focus.moduleId !== mod.id) continue;

    placeLeaves(nodes, edges, mod.id, moduleNode, groups.map((g) => ({
      id: `${mod.id}-grp-${g.id}`,
      kind: g.kind === 'memory' ? 'memory' : (g.kind === 'files' ? 'files' : 'leaf'),
      groupId: g.id,
      title: g.title,
      subtitle: g.subtitle,
      w: 148,
      h: 52,
    })), mod.angle, pos, live, hubNode);

    if (!focus.group) continue;

    const groupNode = nodes.find((n) => n.id === `${mod.id}-grp-${focus.group}`) || moduleNode;

    if (focus.group === 'memory') {
      const tagged = mod.memory || [];
      const centre = model.generalMemory || [];
      const facts = [
        ...tagged.map((m) => ({ ...m, origin: 'tagged' })),
        ...centre.map((m) => ({ ...m, origin: 'centre' })),
      ].slice(0, 10);
      placeLeaves(nodes, edges, groupNode.id, groupNode, facts.length
        ? facts.map((m) => ({
            id: `${mod.id}-fact-${m.id}`,
            kind: 'memory',
            factId: m.id,
            title: clip(m.text, 28),
            subtitle: m.origin === 'centre' ? 'From centre (always passed)' : `Tagged to ${mod.short}`,
            w: 150,
            h: 50,
          }))
        : [{
            id: `${mod.id}-mem-empty`,
            kind: 'empty',
            title: 'No chat memory yet',
            subtitle: 'Facts appear after you confirm them',
            w: 160,
            h: 52,
          }], mod.angle, pos, live, hubNode);
      continue;
    }

    if (focus.group === 'pptx-template' && mod.pptx) {
      placeLeaves(nodes, edges, groupNode.id, groupNode, [{
        id: `${mod.id}-pptx`,
        kind: 'pptx',
        groupId: 'pptx-template',
        title: 'PPT export template',
        subtitle: clip(mod.pptx.fileName || 'Custom', 22),
        w: 150,
        h: 50,
      }], mod.angle, pos, live, hubNode);
      continue;
    }

    if (focus.group === 'goals' && mod.goals) {
      placeLeaves(nodes, edges, groupNode.id, groupNode, [{
        id: `${mod.id}-goals`,
        kind: 'leaf',
        groupId: 'goals',
        title: 'Analysis goals',
        subtitle: clip(mod.goals, 28),
        w: 150,
        h: 50,
      }], mod.angle, pos, live, hubNode);
      continue;
    }

    if (focus.group === 'files') {
      const kinds = kindsFor(mod);
      const kindLeaves = kinds.length
        ? kinds.map((k) => {
            const kindJoins = (mod.joins || []).filter((e) => {
              const ids = new Set(k.files.map((f) => f.id));
              return ids.has(e.fromId) && ids.has(e.toId);
            }).length;
            return {
              id: `${mod.id}-kind-${k.id}`,
              kind: k.id === 'excel' || k.id === 'csv' || k.id === 'json' ? 'data' : (k.id === 'powerpoint' ? 'pptx' : 'file'),
              groupId: 'files',
              kindKey: k.id,
              title: k.title,
              subtitle: kindJoins ? `${k.subtitle} · ${kindJoins} join${kindJoins === 1 ? '' : 's'}` : k.subtitle,
              w: 148,
              h: 52,
            };
          })
        : moduleFiles(mod).map(fileNodeSpec);
      placeLeaves(nodes, edges, groupNode.id, groupNode, kindLeaves, mod.angle, pos, live, hubNode);

      if (focus.kind) {
        const kindNode = nodes.find((n) => n.id === `${mod.id}-kind-${focus.kind}`) || groupNode;
        const kind = kinds.find((k) => k.id === focus.kind);
        const list = kind ? kind.files : moduleFiles(mod).filter((f) => kindOfFile(f) === focus.kind);
        placeLeaves(nodes, edges, kindNode.id, kindNode, list.map(fileNodeSpec), mod.angle, pos, live, hubNode);
      }
    }
  }

  for (const c of model.connections || []) {
    edges.push({ from: c.a, to: c.b, kind: 'share', label: 'sharing context' });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const joinEdges = [];
  for (const mod of model.modules) {
    for (const j of mod.joins || []) {
      const a = `data-${j.fromId}`;
      const b = `data-${j.toId}`;
      if (!nodeIds.has(a) || !nodeIds.has(b)) continue;
      joinEdges.push({ from: a, to: b, kind: 'join', label: j.label });
    }
  }
  const buckets = new Map();
  for (const e of joinEdges) {
    const key = [e.from, e.to].sort().join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  for (const group of buckets.values()) {
    group.forEach((e, i) => {
      edges.push({ ...e, offset: i - (group.length - 1) / 2 });
    });
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
  if (mod.goals) parts.push('Analysis goals');
  if (mod.stellaFiles.length) parts.push(`${mod.stellaFiles.length} data file${mod.stellaFiles.length === 1 ? '' : 's'} and intake notes`);
  if (mod.joins.length) parts.push(`${mod.joins.length} stored join${mod.joins.length === 1 ? '' : 's'} between files`);
  for (const id of mod.linked) {
    const other = model.modules.find((m) => m.id === id);
    if (!other) continue;
    const bits = [];
    if (other.files.length) bits.push(`${other.files.length} file${other.files.length === 1 ? '' : 's'}`);
    if (other.stellaFiles.length) bits.push(`${other.stellaFiles.length} dataset${other.stellaFiles.length === 1 ? '' : 's'}`);
    if (other.joins.length) bits.push(`${other.joins.length} join${other.joins.length === 1 ? '' : 's'}`);
    if (other.memory.length) bits.push(`${other.memory.length} remembered fact${other.memory.length === 1 ? '' : 's'}`);
    parts.push(`Shared from ${other.title}${bits.length ? ` (${bits.join(', ')})` : ''}`);
  }
  return parts;
}

function nodeIcon(node, mod) {
  if (node.kind === 'hub') return UserCog;
  if (node.kind === 'files' || (node.groupId === 'files' && !node.kindKey && !node.fileId)) return Files;
  if (node.kindKey === 'excel' || node.kindKey === 'csv' || node.kindKey === 'json' || node.kind === 'data') return Table2;
  if (node.kind === 'file' || node.kind === 'pptx' || node.fileId) return FileText;
  if (node.kind === 'memory') return Network;
  return mod?.Icon || FileText;
}

function FilePreviewBlock({ file }) {
  const kind = kindOfFile(file);
  const rows = Array.isArray(file.previewRows) ? file.previewRows.slice(0, 3) : [];
  const headers = rows.length
    ? Object.keys(rows[0]).slice(0, 8)
    : (file.columns || []).slice(0, 8).map((c) => c.original || c.name).filter(Boolean);

  if ((kind === 'excel' || kind === 'csv' || kind === 'json') && (rows.length || headers.length)) {
    return (
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-cyan-300/70 font-semibold mb-1.5">
          {rows.length ? 'First rows' : 'Column samples'}
        </div>
        <div className="overflow-x-auto border border-cyan-400/20 rounded-lg">
          <table className="min-w-full text-[10px] text-slate-200">
            <thead className="bg-slate-950/70">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-semibold text-cyan-100/90 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.length ? rows : [{}]).map((row, i) => (
                <tr key={i} className="border-t border-white/5">
                  {headers.map((h) => (
                    <td key={h} className="px-2 py-1 font-mono whitespace-nowrap max-w-[140px] truncate" title={String(row?.[h] ?? '')}>
                      {row?.[h] == null || row?.[h] === '' ? '—' : String(row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (kind === 'powerpoint') {
    const slides = previewLines(file.structuredExtract || file.extractedText, 3);
    return (
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-amber-200/80 font-semibold mb-1.5">Slide / deck preview</div>
        {slides.length ? (
          <ol className="space-y-1">
            {slides.map((line, i) => (
              <li key={i} className="text-[11px] text-slate-200 bg-slate-950/40 border border-amber-400/15 rounded-md px-2 py-1">{line}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-blue-300/45">No slide text stored for this deck yet.</p>
        )}
      </div>
    );
  }

  const lines = previewLines(file.extractedText || file.structuredExtract || file.visionExtract, 3);
  if (!lines.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wide text-blue-300/70 font-semibold mb-1.5">
        {kind === 'pdf' ? 'Document preview' : 'Text preview'}
      </div>
      <div className="text-[11px] text-slate-200 whitespace-pre-wrap bg-slate-950/40 border border-blue-400/15 rounded-lg px-2.5 py-2 leading-relaxed">
        {lines.join('\n')}
      </div>
    </div>
  );
}

function MapCanvas({
  graph,
  byId,
  hub,
  modules,
  selected,
  selectedModule,
  selectedIsAccount,
  openFileId,
  onNodePointerDown,
  glowId,
  shadowId,
  cam,
}) {
  const camX = cam?.x || 0;
  const camY = cam?.y || 0;
  const camK = cam?.k || 1;
  return (
    <div
      className="absolute inset-0 origin-top-left"
      style={{
        transform: `translate(${(camX / CANVAS.w) * 100}%, ${(camY / CANVAS.h) * 100}%) scale(${camK})`,
        transformOrigin: '0 0',
      }}
    >
      <svg
        viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
        className="absolute inset-0 w-full h-full pointer-events-none"
        role="img"
        aria-label="Star schema of captured context"
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(139,92,246,0.18)" />
            <stop offset="100%" stopColor="rgba(139,92,246,0)" />
          </radialGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#020617" floodOpacity="0.9" />
          </filter>
        </defs>
        <circle cx={CANVAS.cx} cy={CANVAS.cy} r="168" fill={`url(#${glowId})`} />
        {graph.edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const path = edgePath(a, b, e.kind, hub, e.offset || 0);
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
                <g filter={`url(#${shadowId})`}>
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
                    fontSize="10"
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
        const mod = (modules || []).find((m) => m.id === node.moduleId || m.id === node.id) || selectedModule;
        const Icon = nodeIcon(node, mod);
        const on = selected === node.id || (node.fileId && node.fileId === openFileId) || (node.factId && node.factId === selected);
        const isOpenFile = !!(node.fileId && node.fileId === openFileId);
        return (
          <button
            key={node.id}
            type="button"
            onPointerDown={(ev) => onNodePointerDown(ev, node, 'move')}
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
            } ${isOpenFile || node.kind === 'files' || node.kindKey || node.fileId || node.groupId || node.factId ? 'z-30' : node.kind === 'module' ? 'z-20' : on ? 'z-20' : 'z-10'} ${isOpenFile ? 'ring-2 ring-cyan-300' : on ? 'ring-2 ring-white/60' : 'hover:ring-1 hover:ring-cyan-300/50'}`}
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
  );
}

export default function ContextMap({
  hubModules = [],
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
  const [large, setLarge] = useState(false);
  const canvasRef = useRef(null);
  const largeCanvasRef = useRef(null);
  const focusRef = useRef(focus);
  const modelRef = useRef(null);
  const graphRef = useRef(null);
  const persistLayoutRef = useRef(null);
  const layoutRef = useRef(layout);
  focusRef.current = focus;
  layoutRef.current = layout;

  const catalog = useMemo(() => withMapVisuals(hubModules), [hubModules]);

  const model = useMemo(() => {
    const connections = Array.isArray(userSettings?.moduleConnections) ? userSettings.moduleConnections : [];
    const accountFields = filledAccountFields(userSettings);
    const generalMemory = memoryFor(userSettings, '');
    const stellaFiles = (stellaDataFiles || []).filter((f) => f && !f.processing);
    const joins = stellaJoinEdges(stellaFiles);
    const name = String(userName || '').trim() || 'You';
    const company = String(companyName || '').trim();
    const modules = catalog.map((mod) => {
      const files = (userSettings?.moduleContext?.[mod.id]?.files || []).filter((f) => f && !f.processing);
      const linked = connectedModuleIds(connections, mod.id);
      return {
        ...mod,
        files: files.map(contextFileSummary),
        memory: memoryFor(userSettings, mod.id),
        linked,
        pptx: mod.pptxTemplate ? userSettings?.pptxTemplate : null,
        goals: mod.goalsKey ? String(userSettings?.stellaBusinessContext?.[mod.goalsKey] || '').trim() : '',
        stellaFiles: mod.dataFiles ? stellaFiles.map(stellaFileSummary) : [],
        joins: mod.dataFiles ? joins : [],
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
  }, [catalog, userSettings, stellaDataFiles, userName, companyName]);

  const graph = useMemo(
    () => layoutStar(model, focus, layout?.nodes, livePos),
    [model, layout, livePos, focus],
  );

  const autoCam = useMemo(() => fitCamera(graph.nodes), [graph]);
  const [camUser, setCamUser] = useState(null);
  useEffect(() => { setCamUser(null); }, [focus.moduleId, focus.group, focus.kind, focus.fileId, focus.factId]);
  const cam = camUser || autoCam;
  const camRef = useRef(cam);
  camRef.current = cam;

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const hub = byId.get('account') || { x: CANVAS.cx, y: CANVAS.cy };

  const persistLayout = (nodes) => {
    if (!onLayoutChange) return;
    const prev = (layoutRef.current?.nodes && typeof layoutRef.current.nodes === 'object')
      ? layoutRef.current.nodes
      : {};
    const next = { nodes: { ...prev } };
    for (const n of nodes) {
      if (!n?.id || (n.kind !== 'hub' && n.kind !== 'module')) continue;
      next.nodes[n.id] = {
        x: n.x / CANVAS.w,
        y: n.y / CANVAS.h,
        w: n.w / CANVAS.w,
        h: n.h / CANVAS.h,
      };
    }
    onLayoutChange(next);
  };
  modelRef.current = model;
  graphRef.current = graph;
  persistLayoutRef.current = persistLayout;

  useEffect(() => {
    if (!large) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') setLarge(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [large]);

  const clientToCanvas = (clientX, clientY, el) => {
    const box = el || canvasRef.current;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const viewX = ((clientX - r.left) / r.width) * CANVAS.w;
    const viewY = ((clientY - r.top) / r.height) * CANVAS.h;
    const c = camRef.current || { k: 1, x: 0, y: 0 };
    const k = c.k || 1;
    return {
      x: (viewX - (c.x || 0)) / k,
      y: (viewY - (c.y || 0)) / k,
    };
  };

  const zoomAt = (clientX, clientY, factor, el) => {
    const loc = clientToCanvas(clientX, clientY, el);
    setCamUser((prev) => {
      const base = prev || camRef.current || { k: 1, x: 0, y: 0 };
      const k = Math.min(2.4, Math.max(0.32, base.k * factor));
      if (!loc) return { ...base, k };
      return {
        k,
        x: base.x + loc.x * (base.k - k),
        y: base.y + loc.y * (base.k - k),
      };
    });
  };

  const selectNode = (node) => {
    if (!node) return;
    const current = focusRef.current;
    if (node.kind === 'hub' || node.id === 'account') {
      setSelected('account');
      setFocus(EMPTY_FOCUS);
      setOpenFileId('');
      return;
    }
    if (node.kind === 'module') {
      if (current.moduleId === node.id && !current.group) {
        setSelected('account');
        setFocus(EMPTY_FOCUS);
        setOpenFileId('');
        return;
      }
      setSelected(node.id);
      setFocus({ moduleId: node.id, group: '', kind: '', fileId: '', factId: '' });
      setOpenFileId('');
      return;
    }
    if (node.factId) {
      if (current.factId === node.factId) {
        setFocus({ moduleId: node.moduleId, group: 'memory', kind: '', fileId: '', factId: '' });
        return;
      }
      setSelected(node.moduleId);
      setFocus({ moduleId: node.moduleId, group: 'memory', kind: '', fileId: '', factId: node.factId });
      setOpenFileId('');
      return;
    }
    if (node.fileId) {
      if (current.fileId === node.fileId) {
        setFocus({ moduleId: node.moduleId, group: node.groupId || 'files', kind: node.kindKey || current.kind || '', fileId: '', factId: '' });
        setOpenFileId('');
        return;
      }
      setSelected(node.moduleId);
      setFocus({
        moduleId: node.moduleId,
        group: node.groupId || 'files',
        kind: node.kindKey || current.kind || '',
        fileId: node.fileId,
        factId: '',
      });
      setOpenFileId(node.fileId);
      return;
    }
    if (node.kindKey) {
      if (current.kind === node.kindKey && !current.fileId) {
        setFocus({ moduleId: node.moduleId, group: 'files', kind: '', fileId: '', factId: '' });
        setOpenFileId('');
        return;
      }
      setSelected(node.moduleId);
      setFocus({ moduleId: node.moduleId, group: 'files', kind: node.kindKey, fileId: '', factId: '' });
      setOpenFileId('');
      return;
    }
    if (node.groupId) {
      if (current.group === node.groupId && !current.kind && !current.fileId && !current.factId) {
        setFocus({ moduleId: node.moduleId, group: '', kind: '', fileId: '', factId: '' });
        setOpenFileId('');
        return;
      }
      setSelected(node.moduleId);
      setFocus({ moduleId: node.moduleId, group: node.groupId, kind: '', fileId: '', factId: '' });
      setOpenFileId('');
    }
  };

  const collapseOne = () => {
    const current = focusRef.current;
    if (current.fileId) {
      setFocus({ ...current, fileId: '' });
      setOpenFileId('');
      return;
    }
    if (current.factId) {
      setFocus({ ...current, factId: '' });
      return;
    }
    if (current.kind) {
      setFocus({ ...current, kind: '', fileId: '', factId: '' });
      return;
    }
    if (current.group) {
      setFocus({ ...current, group: '', kind: '', fileId: '', factId: '' });
      return;
    }
    if (current.moduleId) {
      setSelected('account');
      setFocus(EMPTY_FOCUS);
      setOpenFileId('');
    }
  };

  const onNodePointerDown = (ev, node, mode = 'move') => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const pointerId = ev.pointerId;
    const startClientX = ev.clientX;
    const startClientY = ev.clientY;
    const origin = { x: node.x, y: node.y, w: node.w, h: node.h };
    const surface = ev.currentTarget?.closest?.('[data-ctx-canvas]') || canvasRef.current;
    const grab = clientToCanvas(ev.clientX, ev.clientY, surface);
    let moved = false;

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      if (Math.hypot(e.clientX - startClientX, e.clientY - startClientY) > 8) moved = true;
      if (!moved || !grab) return;
      const loc = clientToCanvas(e.clientX, e.clientY, surface);
      if (!loc) return;
      if (mode === 'resize') {
        const w = Math.max(88, origin.w + (loc.x - grab.x));
        const h = Math.max(40, origin.h + (loc.y - grab.y));
        setLivePos((prev) => ({ ...prev, [node.id]: { ...(prev[node.id] || {}), w, h } }));
        return;
      }
      const x = origin.x + (loc.x - grab.x);
      const y = origin.y + (loc.y - grab.y);
      setLivePos((prev) => ({ ...prev, [node.id]: { ...(prev[node.id] || {}), x, y } }));
    };

    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) {
        const latest = graphRef.current?.nodes || [];
        setLivePos((current) => {
          const merged = latest.map((n) => (current[n.id] ? clampNode({ ...n, ...current[n.id] }) : n));
          persistLayoutRef.current?.(merged);
          return {};
        });
        return;
      }
      if (mode === 'move') selectNode(node);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const resetLayout = () => {
    setLivePos({});
    setCamUser(null);
    onLayoutChange?.({ nodes: {} });
  };

  const selectedModule = model.modules.find((m) => m.id === selected) || null;
  const selectedIsAccount = selected === 'account';
  const focusedFile = selectedModule
    ? moduleFiles(selectedModule).find((f) => f.id === (focus.fileId || openFileId))
    : null;
  const memoryFacts = selectedModule
    ? [
        ...(selectedModule.memory || []).map((m) => ({ ...m, origin: 'tagged' })),
        ...(model.generalMemory || []).map((m) => ({ ...m, origin: 'centre' })),
      ]
    : [];
  const visibleFacts = focus.factId
    ? memoryFacts.filter((m) => m.id === focus.factId)
    : memoryFacts;
  const breadcrumb = (() => {
    if (!selectedModule) return [];
    const bits = [selectedModule.short];
    if (focus.group === 'memory') bits.push('Chat memory');
    if (focus.group === 'files') bits.push('Files');
    if (focus.kind) bits.push(kindMeta(focus.kind).title);
    if (focusedFile) bits.push(focusedFile.name);
    if (focus.factId) {
      const fact = memoryFacts.find((m) => m.id === focus.factId);
      if (fact) bits.push(clip(fact.text, 28));
    }
    if (focus.group === 'pptx-template') bits.push('PPT export template');
    if (focus.group === 'goals') bits.push('Analysis goals');
    return bits;
  })();

  const renderJoins = (joins) => {
    if (!joins?.length) return null;
    return (
      <div className="pt-2">
        <div className="text-xs font-semibold text-blue-200 mb-2">How those files join</div>
        <ul className="space-y-1.5">
          {joins.map((e) => (
            <li key={`${e.fromId}|${e.toId}|${e.label}`} className="text-xs text-slate-200 bg-slate-900/40 border border-cyan-400/20 rounded-lg px-3 py-2 flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-cyan-300 flex-shrink-0" />
              <span><span className="font-semibold">{e.fromName}</span> {e.label} <span className="font-semibold">{e.toName}</span></span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const canvasProps = {
    graph,
    byId,
    hub,
    modules: model.modules,
    selected: focus.factId || selected,
    selectedModule,
    selectedIsAccount,
    openFileId,
    onNodePointerDown,
    cam,
  };

  const toolbar = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 border-t border-blue-400/15 text-[10px] text-blue-200/70 bg-slate-900/40">
      <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-violet-400 rounded" /> Always passed to the AI</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 bg-cyan-400 rounded" /> Modules sharing context</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-cyan-400" /> Stored file join</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/80" /> PowerPoint / strategy</span>
      <button
        type="button"
        onClick={collapseOne}
        disabled={!focus.moduleId}
        className="text-[10px] font-semibold text-cyan-200 hover:text-white disabled:text-blue-300/30"
      >
        Back
      </button>
      <button
        type="button"
        onClick={() => { setSelected('account'); setFocus(EMPTY_FOCUS); setOpenFileId(''); }}
        disabled={!focus.moduleId}
        className="text-[10px] font-semibold text-cyan-200 hover:text-white disabled:text-blue-300/30"
      >
        Collapse
      </button>
      <button
        type="button"
        onClick={() => setLarge((v) => !v)}
        className="text-[10px] font-semibold text-cyan-200 hover:text-white inline-flex items-center gap-1"
      >
        {large ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        {large ? 'Exit full screen' : 'Full screen'}
      </button>
      <button
        type="button"
        onClick={() => setCamUser(null)}
        className="text-[10px] font-semibold text-cyan-200 hover:text-white"
      >
        Fit
      </button>
      <button type="button" onClick={resetLayout} className="ml-auto text-[10px] font-semibold text-cyan-200 hover:text-white">Reset layout</button>
    </div>
  );

  const overlay = large ? createPortal(
    <div
      className="fixed inset-0 z-[200] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={() => setLarge(false)}
    >
      <div
        className="w-full max-w-[1400px] h-[min(92vh,920px)] bg-slate-900 border border-cyan-400/25 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-blue-400/15">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-300" /> Context map
            <span className="text-xs font-normal text-blue-300/60">Click to drill in · drag any card, including remembered facts</span>
          </div>
          <button
            type="button"
            onClick={() => setLarge(false)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-cyan-200 bg-slate-900/60 border border-cyan-400/25 hover:bg-cyan-500/15 flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
        <div className="flex-1 min-h-0 p-3 overflow-hidden">
          <div
            ref={largeCanvasRef}
            data-ctx-canvas="large"
            className="relative w-full h-full bg-slate-950/50 border border-blue-400/15 rounded-xl overflow-hidden"
            onWheel={(e) => {
              e.preventDefault();
              zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.12, e.currentTarget);
            }}
          >
            <MapCanvas
              {...canvasProps}
              glowId="ctx-hub-glow-lg"
              shadowId="ctx-label-shadow-lg"
            />
          </div>
        </div>
        {toolbar}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="space-y-5">
      {overlay}
      <div>
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" /> Context map
        </h3>
        <p className="text-xs text-blue-300/70 leading-relaxed">
          Click a module, then Chat memory or Files. The map zooms to keep the branch in view as you drill in; scroll to zoom. Parent cards stay visible. Drag any card — including remembered facts.
        </p>
      </div>

      <div className="bg-slate-950/50 border border-blue-400/20 rounded-xl overflow-hidden">
        <div
          ref={canvasRef}
          data-ctx-canvas="main"
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}
          onWheel={(e) => {
            e.preventDefault();
            zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.12, e.currentTarget);
          }}
        >
          <MapCanvas
            {...canvasProps}
            glowId="ctx-hub-glow"
            shadowId="ctx-label-shadow"
          />
        </div>
        {toolbar}
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
                      ? `Cyan link: shares context with ${selectedModule.linked.map((id) => MODULE_CONTEXT_LABELS[id] || id).join(' and ')}.`
                      : 'No cyan link — other modules do not receive these files unless you connect them on the home page.'}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenPane?.(selectedModule.pane, selectedModule.dataFiles ? { stellaTab: 'connections' } : undefined)}
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
                <p className="text-[11px] text-blue-300/50 mt-2">Click Chat memory or Files on the map to drill in. Parent cards stay visible.</p>
              </div>
            )}

            {focus.group === 'memory' && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-blue-200">
                  {focus.factId ? 'Selected remembered fact' : `Chat memory for ${selectedModule.short}`}
                </div>
                {visibleFacts.length ? (
                  <ul className="space-y-1.5">
                    {visibleFacts.map((m) => (
                      <li key={m.id} className={`text-xs text-slate-200 bg-slate-900/40 border rounded-lg px-3 py-2 ${m.origin === 'tagged' ? 'border-violet-400/20' : 'border-blue-400/10'}`}>
                        <div>{m.text}</div>
                        <div className="text-[10px] text-blue-300/55 mt-1">
                          {m.origin === 'centre' ? 'From centre (always passed)' : `Tagged to ${selectedModule.short}`}
                          {m.createdAt ? ` · Added ${formatMemoryStamp(m.createdAt)}` : ' · Added date not recorded'}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-blue-300/45">Nothing tagged to this module yet. Confirm a remembered fact while chatting here and it will show up on this arm.</p>
                )}
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
                    onClick={() => setFocus({ moduleId: selectedModule.id, group: 'files', kind: k.id, fileId: '', factId: '' })}
                    className="w-full text-left bg-slate-900/40 border border-blue-400/15 hover:border-cyan-400/40 rounded-lg px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-white">{k.title}</span>
                    <span className="block text-[10px] text-blue-300/50 mt-0.5">{k.files.length} file{k.files.length === 1 ? '' : 's'}</span>
                  </button>
                ))}
                {renderJoins(selectedModule.joins)}
              </div>
            )}

            {focus.group === 'files' && focus.kind && !focusedFile && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-blue-200">
                  {kindMeta(focus.kind).title} — click a file to see captured context
                </div>
                {moduleFiles(selectedModule).filter((f) => kindOfFile(f) === focus.kind).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFocus((prev) => ({ ...prev, fileId: f.id, factId: '' }));
                      setOpenFileId(f.id);
                    }}
                    className="w-full text-left bg-slate-900/40 border border-blue-400/15 hover:border-cyan-400/40 rounded-lg px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-white">{f.name}</span>
                    <span className="block text-[10px] text-blue-300/50 mt-0.5">{f.kindLabel}{f.tableName ? ` · ${f.tableName}` : ''}{f.rowCount != null ? ` · ${f.rowCount} rows` : ''}</span>
                  </button>
                ))}
                {renderJoins(selectedModule.joins.filter((e) => {
                  const ids = new Set(moduleFiles(selectedModule).filter((f) => kindOfFile(f) === focus.kind).map((f) => f.id));
                  return ids.has(e.fromId) && ids.has(e.toId);
                }))}
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
                <FilePreviewBlock file={focusedFile} />
                {!focusedFile.represents && !focusedFile.period && !(focusedFile.metrics || []).length && !(focusedFile.highlights || []).length && !focusedFile.previewRows?.length && !focusedFile.extractedText && (
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
