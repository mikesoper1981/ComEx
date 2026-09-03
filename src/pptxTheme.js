import JSZip from 'jszip';

const EMU_PER_INCH = 914400;

/**
 * ComEx default look â€” used ONLY when the user has not uploaded a template.
 * Never mixed into template-driven exports.
 */
export const DEFAULT_PPTX_GENERATOR_THEME = {
  slideWidth: 10,
  slideHeight: 5.625,
  bgDark: '1E2761',
  bgLight: 'FFFFFF',
  accent: '60A5FA',
  subtitleColor: '93C5FD',
  cardFill: 'FFFFFF',
  cardTransparency: 0,
  contentTextLight: false,
  textOnDark: 'FFFFFF',
  textOnLight: '1E293B',
  textMuted: '64748B',
  border: 'CBD5E1',
  headingFont: 'Calibri',
  bodyFont: 'Calibri',
  cardHeadingFont: 'Calibri',
  titleFontSize: 28,
  subtitleFontSize: 14,
  bodyFontSize: 14,
  cardTitleFontSize: 14,
  cardBodyFontSize: 12,
  titleBold: true,
  schemeName: 'ComEx Default',
  sourceFileName: null,
  backgroundImage: null,
  logos: [],
  blueprint: null,
  blueprints: { title: null, content: null },
  useDefaultChrome: true,
  useContentPanels: true,
};

function normalizeHex(val) {
  if (!val) return null;
  const h = String(val).replace(/^#/, '').trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(h)) return h;
  if (/^[0-9A-F]{8}$/.test(h)) return h.slice(2);
  return null;
}

function hexLuminance(hex) {
  const h = normalizeHex(hex);
  if (!h) return 0;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isLightHex(hex) {
  return hexLuminance(hex) > 0.62;
}

function isNearGrey(hex) {
  const h = normalizeHex(hex);
  if (!h) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 28;
}

function colourScore(hex) {
  const h = normalizeHex(hex);
  if (!h) return -1;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = hexLuminance(h);
  return sat * 2 + (lum > 0.12 && lum < 0.78 ? 1 : 0) + (b > r && b >= g ? 0.6 : 0);
}

function emuToInches(emu) {
  const n = Number(emu);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / EMU_PER_INCH) * 1000) / 1000;
}

function halfPointsToPt(sz) {
  const n = Number(sz);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 100) * 10) / 10;
}

function alphaToTransparency(alphaVal) {
  const a = Number(alphaVal);
  if (!Number.isFinite(a) || a <= 0) return 0;
  const opacityPct = Math.min(100, Math.max(0, a / 1000));
  return Math.round(100 - opacityPct);
}

function extractSlotColor(themeXml, slot) {
  const re = new RegExp(`<(?:\\w+:)?${slot}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${slot}>`, 'i');
  const m = themeXml.match(re);
  if (!m) return null;
  const srgb = m[1].match(/srgbClr[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (srgb) return normalizeHex(srgb[1]);
  const sys = m[1].match(/sysClr[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (sys) return normalizeHex(sys[1]);
  return null;
}

function extractLatinFont(themeXml, which) {
  const re = new RegExp(`<(?:\\w+:)?${which}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${which}>`, 'i');
  const block = themeXml.match(re);
  if (!block) return null;
  const latin = block[1].match(/<(?:\\w+:)?latin\b[^>]*\btypeface\s*=\s*"([^"]+)"/i);
  return latin ? latin[1].trim() : null;
}

function extractSchemeName(themeXml) {
  const m = themeXml.match(/<(?:\\w+:)?clrScheme\b[^>]*\bname\s*=\s*"([^"]+)"/i);
  return m ? m[1] : null;
}

function resolveSchemeColor(schemeClr, colors) {
  if (!schemeClr || !colors) return null;
  const key = String(schemeClr).toLowerCase();
  const map = {
    dk1: colors.dk1, lt1: colors.lt1, dk2: colors.dk2, lt2: colors.lt2,
    accent1: colors.accent1, accent2: colors.accent2, accent3: colors.accent3,
    accent4: colors.accent4, accent5: colors.accent5, accent6: colors.accent6,
    bg1: colors.lt1, bg2: colors.lt2, tx1: colors.dk1, tx2: colors.dk2,
    phclr: colors.accent1,
  };
  return map[key] || null;
}

function extractFillColor(xmlFragment, colors) {
  if (!xmlFragment) return null;
  const srgb = xmlFragment.match(/srgbClr[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (srgb) return normalizeHex(srgb[1]);
  const sys = xmlFragment.match(/sysClr[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (sys) return normalizeHex(sys[1]);
  const scheme = xmlFragment.match(/schemeClr[^>]*\bval\s*=\s*"([^"]+)"/i);
  if (scheme) return resolveSchemeColor(scheme[1], colors);
  return null;
}

function extractFillAlpha(xmlFragment) {
  if (!xmlFragment) return null;
  const fill = xmlFragment.match(/<(?:\w+:)?solidFill\b[\s\S]*?<\/(?:\w+:)?solidFill>/i)?.[0] || xmlFragment;
  const m = fill.match(/<(?:\w+:)?alpha\b[^>]*\bval\s*=\s*"(\d+)"/i);
  return m ? Number(m[1]) : null;
}

function parseRels(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const re = /<Relationship\b[^>]*>/gi;
  let m;
  while ((m = re.exec(relsXml))) {
    const tag = m[0];
    const id = (tag.match(/\bId\s*=\s*"([^"]+)"/i) || [])[1];
    const target = (tag.match(/\bTarget\s*=\s*"([^"]+)"/i) || [])[1];
    if (id && target) map[id] = target.replace(/\\/g, '/');
  }
  return map;
}

function resolveZipPath(fromFile, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.replace(/^\//, '');
  const base = fromFile.split('/').slice(0, -1);
  const parts = [...base, ...target.split('/')];
  const out = [];
  for (const p of parts) {
    if (p === '.' || !p) continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function mimeFromPath(path) {
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.emf') || lower.endsWith('.wmf')) return null;
  return 'image/png';
}

function uint8ToBase64(u8) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readMediaAsDataUrl(zip, mediaPath) {
  const file = zip.file(mediaPath);
  if (!file) return null;
  const buf = await file.async('uint8array');
  if (!buf?.length || buf.length > 6_000_000) return null;
  const lower = String(mediaPath || '').toLowerCase();
  if (lower.endsWith('.emf') || lower.endsWith('.wmf')) {
    try {
      const mod = await import('emf-converter');
      const convert = lower.endsWith('.wmf')
        ? (mod.convertWmfToDataUrl || mod.default?.convertWmfToDataUrl)
        : (mod.convertEmfToDataUrl || mod.default?.convertEmfToDataUrl);
      if (!convert) return null;
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return await convert(ab, { maxWidth: 800, maxHeight: 800, dpiScale: 2 });
    } catch {
      return null;
    }
  }
  const mime = mimeFromPath(mediaPath);
  if (!mime) return null;
  return `data:${mime};base64,${uint8ToBase64(buf)}`;
}

function shapeGeom(block) {
  const xfrm = block.match(/<(?:\w+:)?xfrm\b[^>]*>[\s\S]*?<\/(?:\w+:)?xfrm>/i)?.[0] || '';
  const x = emuToInches((xfrm.match(/\bx\s*=\s*"(-?\d+)"/i) || [])[1]);
  const y = emuToInches((xfrm.match(/\by\s*=\s*"(-?\d+)"/i) || [])[1]);
  const w = emuToInches((xfrm.match(/\bcx\s*=\s*"(\d+)"/i) || [])[1]);
  const h = emuToInches((xfrm.match(/\bcy\s*=\s*"(\d+)"/i) || [])[1]);
  return { x, y, w, h, area: w * h };
}

function shapePreset(block) {
  const prst = (block.match(/prstGeom[^>]*\bprst\s*=\s*"([^"]+)"/i) || [])[1] || 'rect';
  return String(prst).toLowerCase();
}

function pptxShapeName(pptx, preset) {
  const p = String(preset || 'rect').toLowerCase();
  if (p.includes('ellipse') || p.includes('oval')) return pptx.shapes.OVAL;
  if (p.includes('round') || p.includes('corner')) return pptx.shapes.ROUNDED_RECTANGLE;
  return pptx.shapes.RECTANGLE;
}

function firstRunStyle(block, colors) {
  const runs = [...block.matchAll(/<(?:\w+:)?r\b[^>]*>[\s\S]*?<\/(?:\w+:)?r>/gi)].map((m) => m[0]);
  let best = null;
  for (const run of runs) {
    const rPr = run.match(/<(?:\w+:)?rPr\b[^>]*>[\s\S]*?<\/(?:\w+:)?rPr>/i)?.[0]
      || run.match(/<(?:\w+:)?rPr\b[^>]*\/>/i)?.[0]
      || '';
    const size = halfPointsToPt((rPr.match(/\bsz\s*=\s*"(\d+)"/i) || [])[1]);
    const bold = /\bb\s*=\s*"(?:1|true)"/i.test(rPr);
    const font = (rPr.match(/latin[^>]*\btypeface\s*=\s*"([^"]+)"/i) || [])[1] || null;
    const color = extractFillColor(rPr, colors);
    const text = ((run.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    if (!(size || color || font)) continue;
    const cand = { size, bold, font, color, sampleLen: text.length };
    if (!best || (size || 0) > (best.size || 0) || ((size || 0) === (best.size || 0) && bold && !best.bold)) best = cand;
  }
  if (best) return best;
  const defRPr = block.match(/<(?:\w+:)?defRPr\b[^>]*>[\s\S]*?<\/(?:\w+:)?defRPr>/i)?.[0]
    || block.match(/<(?:\w+:)?defRPr\b[^>]*\/>/i)?.[0]
    || '';
  if (defRPr) {
    const size = halfPointsToPt((defRPr.match(/\bsz\s*=\s*"(\d+)"/i) || [])[1]);
    const bold = /\bb\s*=\s*"(?:1|true)"/i.test(defRPr);
    const font = (defRPr.match(/latin[^>]*\btypeface\s*=\s*"([^"]+)"/i) || [])[1] || null;
    const color = extractFillColor(defRPr, colors);
    if (size || color || font) return { size, bold, font, color, sampleLen: 0 };
  }
  return null;
}

function paragraphAlign(block) {
  const algn = String((block.match(/<(?:\w+:)?pPr\b[^>]*\balgn\s*=\s*"([^"]+)"/i) || [])[1] || '').toLowerCase();
  if (algn === 'ctr' || algn === 'center') return 'center';
  if (algn === 'r' || algn === 'right') return 'right';
  return 'left';
}

function collectParagraphTexts(block) {
  const paras = [...block.matchAll(/<(?:\w+:)?p\b[^>]*>[\s\S]*?<\/(?:\w+:)?p>/gi)].map((m) => m[0]);
  return paras.map((p) => {
    const parts = [...p.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    return parts.join('').trim();
  }).filter(Boolean);
}

function placeholderType(block) {
  const ph = block.match(/<(?:\w+:)?ph\b[^>\/]*\/?>/i)?.[0] || '';
  return String((ph.match(/\btype\s*=\s*"([^"]*)"/i) || [])[1] || '').toLowerCase();
}

function cSldName(xml) {
  return (xml.match(/<(?:\w+:)?cSld\b[^>]*\bname\s*=\s*"([^"]+)"/i) || [])[1] || '';
}

function isTitleLayoutName(name, phTypes) {
  const n = String(name || '').toLowerCase();
  const types = (phTypes || []).map((t) => String(t).toLowerCase());
  if (types.includes('ctrtitle')) return true;
  if (/section/.test(n)) return true;
  if (/title/.test(n) && !/content|body|two|obj|comparison|agenda|caption/.test(n)) return true;
  if (types.includes('title') && !types.some((t) => t === 'body' || t === 'obj' || t === 'subtitle')) return true;
  return false;
}

function isCornerLogo(pic, slideWidth, slideHeight) {
  if (!pic) return false;
  const small = pic.w <= slideWidth * 0.22 && pic.h <= slideHeight * 0.22;
  const inCorner = (pic.x < slideWidth * 0.16 || pic.x + pic.w > slideWidth * 0.84)
    && (pic.y < slideHeight * 0.18 || pic.y + pic.h > slideHeight * 0.82);
  return small && inCorner;
}

function classifySlots(textSlots, slideWidth, slideHeight) {
  const byPh = (type) => textSlots.find((s) => s.phType === type) || null;
  const slotsBySize = [...textSlots].sort((a, b) => (b.style?.fontSize || 0) - (a.style?.fontSize || 0));
  const titleSlot = byPh('ctrtitle') || byPh('title')
    || slotsBySize.find((s) => s.y < slideHeight * 0.32 && (s.style?.fontSize || 0) >= 16)
    || slotsBySize[0]
    || null;
  const subtitleSlot = byPh('subtitle')
    || textSlots.filter((s) => s !== titleSlot && s.y < slideHeight * 0.42 && s.w > slideWidth * 0.35).sort((a, b) => a.y - b.y)[0]
    || null;
  const bodySlot = byPh('body') || byPh('obj')
    || textSlots.filter((s) => s !== titleSlot && s !== subtitleSlot && s.y >= slideHeight * 0.22).sort((a, b) => b.area - a.area)[0]
    || null;
  const contentSlots = textSlots.filter((s) => s !== titleSlot && s !== subtitleSlot && s.y >= slideHeight * 0.22);
  const cardColumns = [];
  const used = new Set();
  const titleLike = contentSlots.filter((s) => s.h <= 1.2 && (s.style?.fontSize || 0) >= 12);
  const bodyLike = contentSlots.filter((s) => s.h > 1.2 || (s.paragraphCount || 1) >= 2);
  for (const t of titleLike) {
    if (used.has(t)) continue;
    const body = bodyLike.find((b) => !used.has(b) && Math.abs(b.x - t.x) < 0.6 && b.y > t.y);
    used.add(t);
    if (body) used.add(body);
    cardColumns.push({ title: t, body: body || null });
  }
  for (const b of bodyLike) {
    if (used.has(b)) continue;
    used.add(b);
    cardColumns.push({ title: null, body: b });
  }
  for (const s of contentSlots) {
    if (used.has(s)) continue;
    used.add(s);
    cardColumns.push({ title: s, body: null });
  }
  cardColumns.sort((a, b) => (a.title?.x ?? a.body?.x ?? 0) - (b.title?.x ?? b.body?.x ?? 0));
  return { titleSlot, subtitleSlot, bodySlot, cardColumns };
}

function relatedLayoutPath(zip, xmlPath) {
  const relsPath = xmlPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const file = zip.file(relsPath);
  if (!file) return Promise.resolve(null);
  return file.async('text').then((xml) => {
    const rels = parseRels(xml);
    const target = Object.values(rels).find((t) => /slideLayout\d+\.xml/i.test(String(t)));
    if (!target) return null;
    return resolveZipPath(xmlPath, target);
  });
}

async function parseXmlSurface(zip, xmlPath, colors, slideWidth, slideHeight, { includeAllPictures = false } = {}) {
  const file = zip.file(xmlPath);
  if (!file) return null;
  const xml = await file.async('text');
  const relsPath = xmlPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = parseRels(zip.file(relsPath) ? await zip.file(relsPath).async('text') : '');
  const partDir = xmlPath.split('/').slice(0, -1).join('/');

  const bgBlock = xml.match(/<(?:\w+:)?bg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?bg>/i)?.[1] || '';
  const bgEmbed = (bgBlock.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i) || [])[1];
  let backgroundImage = null;
  if (bgEmbed && rels[bgEmbed]) {
    backgroundImage = await readMediaAsDataUrl(zip, resolveZipPath(`${partDir}/file.xml`, rels[bgEmbed]));
  }
  const backgroundColor = extractFillColor(bgBlock, colors);

  const chromeShapes = [];
  const textSlots = [];
  const phTypes = [];
  const shapes = [...xml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)].map((m) => m[0]);
  for (const block of shapes) {
    const geom = shapeGeom(block);
    if (geom.w <= 0 || geom.h <= 0) continue;
    const spPr = block.match(/<(?:\w+:)?spPr\b[\s\S]*?<\/(?:\w+:)?spPr>/i)?.[0] || '';
    const preset = shapePreset(block);
    const hasNoFill = /<(?:\w+:)?noFill\b/i.test(spPr);
    const fill = !hasNoFill && /solidFill/i.test(spPr) ? extractFillColor(spPr, colors) : null;
    const alpha = !hasNoFill ? extractFillAlpha(spPr) : null;
    const transparency = alpha != null ? alphaToTransparency(alpha) : 0;
    const style = firstRunStyle(block, colors);
    const paras = collectParagraphTexts(block);
    const phType = placeholderType(block);
    if (phType) phTypes.push(phType);
    if (fill) chromeShapes.push({ kind: 'shape', preset, ...geom, fill, transparency });
    if (phType || (style && (paras.length || style.size))) {
      const align = phType === 'ctrtitle' ? 'center' : paragraphAlign(block);
      textSlots.push({
        kind: 'text',
        phType,
        ...geom,
        style: {
          fontSize: style?.size || null,
          bold: !!style?.bold,
          fontFace: style?.font || null,
          color: style?.color || null,
          align,
        },
        paragraphCount: Math.max(1, paras.length),
      });
    }
  }

  const pictures = [];
  const picBlocks = [...xml.matchAll(/<(?:\w+:)?pic\b[^>]*>[\s\S]*?<\/(?:\w+:)?pic>/gi)].map((m) => m[0]);
  for (const block of picBlocks) {
    const embed = (block.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i) || [])[1];
    if (!embed || !rels[embed] || embed === bgEmbed) continue;
    const geom = shapeGeom(block);
    if (geom.w < 0.08 || geom.h < 0.08) continue;
    const mediaPath = resolveZipPath(`${partDir}/file.xml`, rels[embed]);
    const data = await readMediaAsDataUrl(zip, mediaPath);
    if (!data) continue;
    if (geom.w >= slideWidth * 0.92 && geom.h >= slideHeight * 0.92) {
      if (!backgroundImage) backgroundImage = data;
      continue;
    }
    const pic = { kind: 'picture', data, ...geom };
    if (includeAllPictures || isCornerLogo(pic, slideWidth, slideHeight)) pictures.push(pic);
  }

  const slots = classifySlots(textSlots, slideWidth, slideHeight);
  const panelShapes = chromeShapes
    .filter((s) => s.area > 1.5 && s.w < slideWidth * 0.95)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const name = cSldName(xml);
  return {
    name,
    kind: isTitleLayoutName(name, phTypes) ? 'title' : 'content',
    backgroundImage,
    backgroundColor,
    chromeShapes,
    pictures,
    panelShapes,
    phTypes,
    ...slots,
  };
}

function isEdgeChrome(shape, slideWidth, slideHeight) {
  if (!shape) return false;
  const header = shape.y <= slideHeight * 0.12 && shape.h <= slideHeight * 0.18 && shape.w >= slideWidth * 0.5;
  const footer = (shape.y + shape.h) >= slideHeight * 0.88 && shape.h <= slideHeight * 0.16 && shape.w >= slideWidth * 0.5;
  const railW = Math.min(0.55, slideWidth * 0.08);
  const leftRail = shape.x <= slideWidth * 0.03 && shape.w <= railW && shape.h >= slideHeight * 0.45;
  const rightRail = (shape.x + shape.w) >= slideWidth * 0.97 && shape.w <= railW && shape.h >= slideHeight * 0.45;
  return header || footer || leftRail || rightRail;
}

function mergeSurfaces(master, layout, slide, slideWidth, slideHeight) {
  if (!master && !layout && !slide) return null;
  const chromeSeen = new Set();
  const chromeShapes = [];
  const addChrome = (list, filterFn) => {
    for (const sh of list || []) {
      if (filterFn && !filterFn(sh)) continue;
      const key = `${sh.fill}:${Math.round(sh.x * 10)}:${Math.round(sh.y * 10)}:${Math.round(sh.w * 10)}:${Math.round(sh.h * 10)}`;
      if (chromeSeen.has(key)) continue;
      chromeSeen.add(key);
      chromeShapes.push(sh);
    }
  };
  addChrome(master?.chromeShapes);
  addChrome(layout?.chromeShapes);
  addChrome(slide?.chromeShapes, (s) => isEdgeChrome(s, slideWidth, slideHeight));

  const pictures = [];
  const seen = new Set();
  for (const layer of [master, layout, slide]) {
    for (const p of (layer?.pictures || [])) {
      const key = `${Math.round(p.x * 20)}:${Math.round(p.y * 20)}:${Math.round(p.w * 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pictures.push(p);
    }
  }

  const pick = (key) => layout?.[key] || slide?.[key] || master?.[key] || null;
  return {
    kind: layout?.kind || slide?.kind || 'content',
    name: layout?.name || slide?.name || '',
    slideWidth,
    slideHeight,
    backgroundImage: slide?.backgroundImage || layout?.backgroundImage || master?.backgroundImage || null,
    backgroundColor: slide?.backgroundColor || layout?.backgroundColor || master?.backgroundColor || null,
    chromeShapes,
    pictures,
    panelShapes: layout?.panelShapes || [],
    titleSlot: pick('titleSlot'),
    subtitleSlot: pick('subtitleSlot'),
    bodySlot: pick('bodySlot'),
    cardColumns: layout?.cardColumns?.length ? layout.cardColumns : [],
  };
}

function surfaceToBlueprint(surface) {
  if (!surface) return null;
  return {
    slideWidth: surface.slideWidth,
    slideHeight: surface.slideHeight,
    backgroundImage: surface.backgroundImage || null,
    backgroundColor: surface.backgroundColor || null,
    chromeShapes: surface.chromeShapes || [],
    pictures: surface.pictures || [],
    titleSlot: surface.titleSlot || null,
    subtitleSlot: surface.subtitleSlot || null,
    bodySlot: surface.bodySlot || null,
    cardColumns: surface.cardColumns || [],
    panelShapes: surface.panelShapes || [],
  };
}

/**
 * Capture corporate identity from an uploaded deck: slide size, theme colours,
 * fonts, logos, backgrounds, and separate title vs content layouts.
 */
export async function extractPptxThemeFromArrayBuffer(arrayBuffer, fileName = null) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = zip.files;

  let slideWidth = 10;
  let slideHeight = 5.625;
  const presPath = Object.keys(files).find((n) => /^ppt\/presentation\.xml$/i.test(n));
  if (presPath) {
    const presXml = await zip.file(presPath).async('text');
    const cx = Number((presXml.match(/<(?:\w+:)?sldSz[^>]*\bcx\s*=\s*"(\d+)"/i) || [])[1]);
    const cy = Number((presXml.match(/<(?:\w+:)?sldSz[^>]*\bcy\s*=\s*"(\d+)"/i) || [])[1]);
    if (cx > 0 && cy > 0) {
      slideWidth = Math.round((cx / EMU_PER_INCH) * 1000) / 1000;
      slideHeight = Math.round((cy / EMU_PER_INCH) * 1000) / 1000;
    }
  }

  const colors = {};
  let fonts = { heading: null, body: null };
  let schemeName = 'Custom';
  const themePath = Object.keys(files).find((n) => /^ppt\/theme\/theme\d+\.xml$/i.test(n));
  if (themePath) {
    const themeXml = await zip.file(themePath).async('text');
    for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
      const hex = extractSlotColor(themeXml, slot);
      if (hex) colors[slot] = hex;
    }
    fonts = {
      heading: extractLatinFont(themeXml, 'majorFont'),
      body: extractLatinFont(themeXml, 'minorFont'),
    };
    schemeName = extractSchemeName(themeXml) || 'Custom';
  }

  const masterPaths = Object.keys(files)
    .filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(n))
    .sort();
  const layoutPaths = Object.keys(files)
    .filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(n))
    .sort((a, b) => Number((a.match(/(\d+)/) || [])[1] || 0) - Number((b.match(/(\d+)/) || [])[1] || 0));
  const slidePaths = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => Number((a.match(/slide(\d+)/i) || [])[1] || 0) - Number((b.match(/slide(\d+)/i) || [])[1] || 0));

  if (!slidePaths.length && !layoutPaths.length) throw new Error('No slides found in this PowerPoint');

  const masters = [];
  for (const p of masterPaths) {
    masters.push(await parseXmlSurface(zip, p, colors, slideWidth, slideHeight, { includeAllPictures: true }));
  }
  const layouts = [];
  const layoutByPath = {};
  for (const p of layoutPaths) {
    const surface = await parseXmlSurface(zip, p, colors, slideWidth, slideHeight, { includeAllPictures: true });
    layouts.push(surface);
    layoutByPath[p] = surface;
  }
  const slidePairs = [];
  for (const p of slidePaths.slice(0, 12)) {
    const surface = await parseXmlSurface(zip, p, colors, slideWidth, slideHeight, { includeAllPictures: false });
    const layoutPath = await relatedLayoutPath(zip, p);
    const boundLayout = (layoutPath && layoutByPath[layoutPath]) || null;
    if (surface && boundLayout?.kind === 'title' && surface.kind !== 'title') surface.kind = 'title';
    slidePairs.push({ surface, layout: boundLayout });
  }

  const titlePair = slidePairs.find((s) => s.layout?.kind === 'title' || s.surface?.kind === 'title')
    || slidePairs[0]
    || null;
  const contentPair = slidePairs.find((s) => s !== titlePair && (s.layout?.kind === 'content' || s.surface?.kind === 'content'))
    || slidePairs.find((s) => s !== titlePair)
    || titlePair;

  const titleLayout = titlePair?.layout || layouts.find((l) => l?.kind === 'title') || null;
  const contentLayout = contentPair?.layout
    || layouts.find((l) => l?.kind === 'content')
    || layouts.find((l) => l && l !== titleLayout)
    || titleLayout;
  const titleSlide = titlePair?.surface || null;
  const contentSlide = contentPair?.surface || titleSlide;

  const master = masters[0] || null;
  const titleSurface = mergeSurfaces(master, titleLayout, titleSlide, slideWidth, slideHeight);
  const contentSurface = mergeSurfaces(master, contentLayout, contentSlide, slideWidth, slideHeight)
    || titleSurface;

  if (titleSurface) titleSurface.kind = 'title';
  if (contentSurface) contentSurface.kind = 'content';

  const titleBp = surfaceToBlueprint(titleSurface);
  const contentBp = surfaceToBlueprint(contentSurface);
  const blueprint = contentBp || titleBp;

  const titleStyle = titleBp?.titleSlot?.style || {};
  const subtitleStyle = titleBp?.subtitleSlot?.style || contentBp?.subtitleSlot?.style || {};
  const cardTitleStyle = contentBp?.cardColumns?.find((c) => c.title)?.title?.style || {};
  const cardBodyStyle = contentBp?.cardColumns?.find((c) => c.body)?.body?.style
    || contentBp?.bodySlot?.style
    || {};
  const panel = (contentBp?.panelShapes || [])[0];
  const brandCandidates = [
    colors.accent1, colors.accent5, colors.dk2,
    ...(titleBp?.chromeShapes || []).map((s) => s.fill),
    ...(contentBp?.chromeShapes || []).map((s) => s.fill),
  ].map(normalizeHex).filter((c) => c && !isNearGrey(c) && !isLightHex(c));
  brandCandidates.sort((a, b) => colourScore(b) - colourScore(a));

  const contentTextLight = !!(
    (cardBodyStyle.color && isLightHex(cardBodyStyle.color))
    || (titleStyle.color && isLightHex(titleStyle.color) && contentBp === titleBp)
    || (panel && panel.transparency >= 50)
  );

  const logos = [...(titleBp?.pictures || []), ...(contentBp?.pictures || [])];
  const logoSeen = new Set();
  const uniqueLogos = logos.filter((p) => {
    const key = `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
    if (logoSeen.has(key)) return false;
    logoSeen.add(key);
    return true;
  });

  return {
    schemeName,
    colors,
    fonts: {
      heading: titleStyle.fontFace || fonts.heading,
      body: cardBodyStyle.fontFace || subtitleStyle.fontFace || fonts.body,
      cardHeading: cardTitleStyle.fontFace || titleStyle.fontFace || fonts.heading,
    },
    typography: {
      titleFontSize: titleStyle.fontSize || null,
      subtitleFontSize: subtitleStyle.fontSize || null,
      bodyFontSize: cardBodyStyle.fontSize || null,
      cardTitleFontSize: cardTitleStyle.fontSize || null,
      cardBodyFontSize: cardBodyStyle.fontSize || null,
      titleBold: titleStyle.bold !== false,
      titleColor: titleStyle.color || null,
      subtitleColor: subtitleStyle.color || null,
      bodyColor: cardBodyStyle.color || null,
      cardTitleColor: cardTitleStyle.color || null,
    },
    slideWidth,
    slideHeight,
    backgroundImage: titleBp?.backgroundImage || contentBp?.backgroundImage || null,
    logos: uniqueLogos,
    blueprint,
    blueprints: {
      title: titleBp,
      content: contentBp,
    },
    palette: {
      bgDark: brandCandidates[0] || colors.accent1 || null,
      bgLight: contentBp?.backgroundColor || colors.lt1 || null,
      accent: colors.accent1 || brandCandidates[0] || null,
      subtitleColor: subtitleStyle.color || null,
      cardFill: panel?.fill || null,
      cardTransparency: panel?.transparency || 0,
      contentTextLight,
      textOnDark: titleStyle.color || null,
      textOnLight: cardBodyStyle.color || null,
    },
    sourceFileName: fileName || null,
    extractedAt: new Date().toISOString(),
    sampledSlides: slidePaths.length,
    capturedLayouts: {
      title: !!titleBp,
      content: !!contentBp,
    },
    useContentPanels: !!(contentLayout?.panelShapes?.length),
  };
}

export async function extractPptxThemeFromFile(file) {
  const buf = await file.arrayBuffer();
  return extractPptxThemeFromArrayBuffer(buf, file.name);
}

export function themeToSettingsMeta(extracted) {
  if (!extracted) return null;
  // Persist styles/layout metadata only — binary assets reload from storage on export
  const titleBp = extracted.blueprints?.title || extracted.blueprint;
  const contentBp = extracted.blueprints?.content || extracted.blueprint;
  return {
    schemeName: extracted.schemeName,
    colors: extracted.colors,
    fonts: extracted.fonts,
    typography: extracted.typography,
    slideWidth: extracted.slideWidth,
    slideHeight: extracted.slideHeight,
    palette: extracted.palette,
    logoCount: Array.isArray(extracted.logos) ? extracted.logos.length : 0,
    hasBackgroundImage: !!(extracted.backgroundImage || titleBp?.backgroundImage || contentBp?.backgroundImage),
    capturedLayouts: extracted.capturedLayouts || {
      title: !!titleBp,
      content: !!contentBp,
    },
    useContentPanels: !!extracted.useContentPanels,
    blueprintMeta: contentBp ? {
      chromeShapeCount: (titleBp?.chromeShapes?.length || 0) + (contentBp?.chromeShapes?.length || 0),
      pictureCount: Array.isArray(extracted.logos) ? extracted.logos.length : (contentBp.pictures?.length || 0),
      cardColumnCount: contentBp.cardColumns?.length || 0,
      hasTitleSlot: !!(titleBp?.titleSlot || contentBp.titleSlot),
      hasSubtitleSlot: !!(titleBp?.subtitleSlot || contentBp.subtitleSlot),
    } : null,
    sampledSlides: extracted.sampledSlides || 0,
    sourceFileName: extracted.sourceFileName,
    extractedAt: extracted.extractedAt,
  };
}

export function resolvePptxGeneratorTheme(extracted) {
  if (!extracted?.blueprint && !extracted?.blueprints && !extracted?.palette && !extracted?.colors) {
    return { ...DEFAULT_PPTX_GENERATOR_THEME };
  }
  const p = extracted.palette || {};
  const t = extracted.typography || {};
  const f = extracted.fonts || {};
  const blueprints = extracted.blueprints || {
    title: extracted.blueprint || null,
    content: extracted.blueprint || null,
  };
  return {
    slideWidth: extracted.slideWidth,
    slideHeight: extracted.slideHeight,
    bgDark: normalizeHex(p.bgDark),
    bgLight: normalizeHex(p.bgLight) || normalizeHex(extracted.colors?.lt1),
    accent: normalizeHex(p.accent),
    subtitleColor: normalizeHex(p.subtitleColor) || normalizeHex(t.subtitleColor),
    cardFill: normalizeHex(p.cardFill),
    cardTransparency: Number(p.cardTransparency) || 0,
    contentTextLight: !!p.contentTextLight,
    textOnDark: normalizeHex(p.textOnDark) || normalizeHex(t.titleColor),
    textOnLight: normalizeHex(p.textOnLight) || normalizeHex(t.bodyColor),
    textMuted: normalizeHex(p.subtitleColor),
    border: normalizeHex(extracted.colors?.lt2),
    headingFont: f.heading || null,
    bodyFont: f.body || null,
    cardHeadingFont: f.cardHeading || null,
    titleFontSize: t.titleFontSize || null,
    subtitleFontSize: t.subtitleFontSize || null,
    bodyFontSize: t.bodyFontSize || null,
    cardTitleFontSize: t.cardTitleFontSize || null,
    cardBodyFontSize: t.cardBodyFontSize || null,
    titleBold: t.titleBold !== false,
    schemeName: extracted.schemeName || 'Custom',
    sourceFileName: extracted.sourceFileName || null,
    backgroundImage: extracted.backgroundImage || blueprints.title?.backgroundImage || blueprints.content?.backgroundImage || null,
    logos: Array.isArray(extracted.logos) ? extracted.logos : [],
    blueprint: extracted.blueprint || blueprints.content || blueprints.title || null,
    blueprints,
    useDefaultChrome: false,
    useContentPanels: !!extracted.useContentPanels,
  };
}

export function getPptxGeneratorThemeFromUserSettings(userSettings) {
  const tpl = userSettings?.pptxTemplate;
  if (tpl?.theme?.palette || tpl?.theme?.colors || tpl?.theme?.blueprintMeta) {
    return resolvePptxGeneratorTheme(tpl.theme);
  }
  return { ...DEFAULT_PPTX_GENERATOR_THEME };
}

export async function loadFullPptxStyleForGeneration(userSettings, supabaseClient) {
  const tpl = userSettings?.pptxTemplate;
  if (!tpl?.storagePath || !supabaseClient) {
    return getPptxGeneratorThemeFromUserSettings(userSettings);
  }
  try {
    const bucket = tpl.storageBucket || 'intelligence';
    const { data, error } = await supabaseClient.storage.from(bucket).download(tpl.storagePath);
    if (error || !data) return getPptxGeneratorThemeFromUserSettings(userSettings);
    const buf = await data.arrayBuffer();
    const extracted = await extractPptxThemeFromArrayBuffer(buf, tpl.fileName || tpl.theme?.sourceFileName);
    return resolvePptxGeneratorTheme(extracted);
  } catch (e) {
    console.warn('Could not reload PPTX template assets; using saved theme metadata.', e);
    return getPptxGeneratorThemeFromUserSettings(userSettings);
  }
}
function isTitleKind(layout) {
  return layout === 'title' || layout === 'section';
}

function blueprintFor(theme, layout) {
  const bps = theme?.blueprints || {};
  if (isTitleKind(layout)) return bps.title || bps.content || theme.blueprint || null;
  return bps.content || bps.title || theme.blueprint || null;
}

function withSlideBlueprint(theme, layout) {
  const bp = blueprintFor(theme, layout);
  return {
    ...theme,
    blueprint: bp,
    backgroundImage: bp?.backgroundImage || theme.backgroundImage || null,
  };
}

function applyBackground(slide, theme, { layout } = {}) {
  const bp = theme.blueprint;
  const image = bp?.backgroundImage || theme.backgroundImage;
  if (image) {
    try {
      slide.background = { data: image };
      return;
    } catch { /* fall through */ }
  }
  if (theme.useDefaultChrome) {
    const dark = isTitleKind(layout);
    slide.background = { color: dark ? (theme.bgDark || '1E2761') : (theme.bgLight || 'FFFFFF') };
    return;
  }
  const color = bp?.backgroundColor
    || (isTitleKind(layout) && theme.textOnDark && isLightHex(theme.textOnDark) ? (theme.bgDark || theme.bgLight) : null)
    || theme.bgLight
    || 'FFFFFF';
  if (color) slide.background = { color };
}

function applyBrandChrome(pptx, slide, theme) {
  if (theme.useDefaultChrome) return;
  const bp = theme.blueprint;
  if (!bp) return;
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  for (const sh of (bp.chromeShapes || [])) {
    if (!sh.fill || sh.w <= 0 || sh.h <= 0) continue;
    const isHuge = sh.w > W * 0.88 && sh.h > H * 0.55;
    if (isHuge && isLightHex(sh.fill) && (sh.transparency || 0) < 20) continue;
    try {
      slide.addShape(pptxShapeName(pptx, sh.preset), {
        x: sh.x, y: sh.y, w: sh.w, h: sh.h,
        fill: { color: sh.fill, transparency: sh.transparency || 0 },
        line: { color: sh.fill, transparency: 100 },
      });
    } catch { /* skip unmapped presets */ }
  }
  for (const pic of (bp.pictures || [])) {
    if (!pic.data) continue;
    try {
      slide.addImage({ data: pic.data, x: pic.x, y: pic.y, w: pic.w, h: pic.h });
    } catch { /* skip broken media */ }
  }
}

function styleOpts(style = {}, fallback = {}) {
  return {
    fontSize: style?.fontSize || fallback.fontSize || null,
    bold: style?.bold ?? fallback.bold ?? false,
    color: style?.color || fallback.color || null,
    fontFace: style?.fontFace || fallback.fontFace || null,
  };
}

function splitBullet(text) {
  const s = String(text || '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < 48) {
    return { heading: s.slice(0, colon).trim(), body: s.slice(colon + 1).trim() };
  }
  return { heading: null, body: s };
}

function panelFill(theme) {
  const color = theme.cardFill || (theme.useDefaultChrome ? 'FFFFFF' : 'FFFFFF');
  const transparency = theme.cardTransparency || 0;
  if (transparency > 0) return { color, transparency };
  return { color };
}

function titleStyleFromTheme(theme) {
  const slot = theme.blueprint?.titleSlot;
  return {
    ...styleOpts(slot?.style, {
      fontSize: theme.titleFontSize || 28,
      color: theme.textOnDark || (theme.useDefaultChrome ? 'FFFFFF' : '1E293B'),
      fontFace: theme.headingFont || 'Calibri',
      bold: theme.titleBold !== false,
    }),
    align: slot?.style?.align || (slot?.phType === 'ctrtitle' ? 'center' : 'left'),
  };
}

function subtitleStyleFromTheme(theme) {
  return styleOpts(theme.blueprint?.subtitleSlot?.style, {
    fontSize: theme.subtitleFontSize || 13,
    color: theme.subtitleColor || theme.textOnDark || 'CFE6F5',
    fontFace: theme.bodyFont || 'Calibri',
  });
}

function bodyStyleFromTheme(theme) {
  const sample = theme.blueprint?.cardColumns?.find((c) => c.body)?.body?.style
    || theme.blueprint?.bodySlot?.style
    || theme.blueprint?.cardColumns?.find((c) => c.title)?.title?.style;
  return styleOpts(sample, {
    fontSize: theme.bodyFontSize || theme.cardBodyFontSize || 13,
    color: theme.textOnLight || (theme.contentTextLight ? 'FFFFFF' : '1E293B'),
    fontFace: theme.bodyFont || 'Calibri',
  });
}

function cardTitleStyleFromTheme(theme) {
  const sample = theme.blueprint?.cardColumns?.find((c) => c.title)?.title?.style;
  return styleOpts(sample, {
    fontSize: theme.cardTitleFontSize || 14,
    color: theme.textOnLight || (theme.contentTextLight ? 'FFFFFF' : '1E293B'),
    fontFace: theme.cardHeadingFont || theme.headingFont || 'Calibri',
    bold: true,
  });
}

function contentTop(theme, hasSubtitle) {
  const bp = theme.blueprint;
  if (hasSubtitle && bp?.subtitleSlot) return bp.subtitleSlot.y + bp.subtitleSlot.h + 0.25;
  if (bp?.titleSlot) return bp.titleSlot.y + bp.titleSlot.h + 0.3;
  return hasSubtitle ? 1.55 : 1.2;
}

function addTitleAndSubtitle(pptx, slide, theme, { title, subtitle }) {
  const W = theme.slideWidth || 10;
  const bp = theme.blueprint;
  const ts = titleStyleFromTheme(theme);
  const titleBox = bp?.titleSlot || { x: 0.5, y: 0.3, w: W - 1, h: 0.7 };
  if (title) {
    slide.addText(String(title), {
      x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h,
      fontSize: Math.min(ts.fontSize || 28, 30),
      bold: true,
      color: ts.color,
      fontFace: ts.fontFace,
      align: ts.align || 'left',
      valign: 'middle',
    });
  }
  if (subtitle) {
    const ss = subtitleStyleFromTheme(theme);
    const subBox = bp?.subtitleSlot || { x: 0.5, y: titleBox.y + titleBox.h + 0.05, w: W - 1, h: 0.35 };
    slide.addText(String(subtitle), {
      x: subBox.x, y: subBox.y, w: subBox.w, h: subBox.h,
      fontSize: ss.fontSize,
      color: ss.color,
      fontFace: ss.fontFace,
      align: 'left',
      valign: 'middle',
    });
  }
}

function addPanel(pptx, slide, theme, { x, y, w, h }) {
  if (!theme.useDefaultChrome && !theme.useContentPanels) return;
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: panelFill(theme),
    line: { color: theme.cardFill || 'FFFFFF', transparency: Math.min(95, (theme.cardTransparency || 0) + 5) },
    rectRadius: 0.06,
  });
}

function inferLayout(slide, idx) {
  const explicit = String(slide.layout || '').toLowerCase().trim();
  const allowed = new Set(['title', 'section', 'bullets', 'cards', 'table', 'two_column', 'process', 'callout', 'one_pager']);
  if (allowed.has(explicit)) return explicit;

  const type = String(slide.type || '').toLowerCase();
  if (type === 'one_pager' || type === 'one-pager' || type === 'scheme_snapshot') return 'one_pager';
  if (type === 'title' || idx === 0) return 'title';
  if (type === 'section') return 'section';
  if (type === 'table' || (slide.tableData?.headers?.length && slide.tableData?.rows?.length)) return 'table';
  if (Array.isArray(slide.bulletsRight) && slide.bulletsRight.length) return 'two_column';
  if (type === 'summary' && slide.body && !(slide.bullets?.length > 3)) return 'callout';

  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const labeled = bullets.filter((b) => splitBullet(b).heading).length;
  if (bullets.length >= 3 && bullets.length <= 5 && labeled >= Math.ceil(bullets.length * 0.6)) return 'cards';
  if (bullets.length >= 3 && bullets.length <= 6 && /step|phase|then|first|second|1\.|2\./i.test(bullets.join(' '))) return 'process';
  if (slide.body && bullets.length <= 2) return 'callout';
  return 'bullets';
}

/**
 * Template supplies slide size, background, colours, fonts, logos and chrome.
 * Title vs content layouts are chosen from the captured corporate identity.
 */
export function renderSlideFromTheme(pptx, theme, slide, idx = 0) {
  const base = !theme || theme.useDefaultChrome
    ? { ...DEFAULT_PPTX_GENERATOR_THEME, ...(theme || {}) }
    : theme;
  const layout = inferLayout(slide, idx);
  const t = withSlideBlueprint(base, layout);
  const s = pptx.addSlide();
  applyBackground(s, t, { layout });
  applyBrandChrome(pptx, s, t);

  if (layout === 'title') return renderLayoutTitle(pptx, s, t, slide);
  if (layout === 'section') return renderLayoutSection(pptx, s, t, slide);
  if (layout === 'one_pager') return renderLayoutOnePager(pptx, s, t, slide, idx);
  if (layout === 'table') return renderLayoutTable(pptx, s, t, slide, idx);
  if (layout === 'cards') return renderLayoutCards(pptx, s, t, slide, idx);
  if (layout === 'two_column') return renderLayoutTwoColumn(pptx, s, t, slide, idx);
  if (layout === 'process') return renderLayoutProcess(pptx, s, t, slide, idx);
  if (layout === 'callout') return renderLayoutCallout(pptx, s, t, slide, idx);
  return renderLayoutBullets(pptx, s, t, slide, idx);
}

function renderLayoutTitle(pptx, s, theme, slide) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  const ts = titleStyleFromTheme(theme);
  const ss = subtitleStyleFromTheme(theme);
  const bp = theme.blueprint;
  const panelY = Math.max(2.0, (bp?.subtitleSlot?.y || 1.2) + 0.7);
  if (theme.useDefaultChrome || theme.useContentPanels) {
    addPanel(pptx, s, theme, { x: 0.5, y: panelY, w: W - 1, h: Math.max(2.2, H - panelY - 0.4) });
  }

  s.addText(slide.title || '', {
    x: bp?.titleSlot?.x ?? 0.5,
    y: bp?.titleSlot?.y ?? 0.45,
    w: bp?.titleSlot?.w ?? (W - 1),
    h: bp?.titleSlot?.h ?? 0.9,
    fontSize: ts.fontSize || 32,
    bold: true,
    color: ts.color,
    fontFace: ts.fontFace,
    align: ts.align || 'left',
    valign: 'middle',
  });
  if (slide.subtitle) {
    s.addText(String(slide.subtitle), {
      x: bp?.subtitleSlot?.x ?? 0.5,
      y: bp?.subtitleSlot?.y ?? 1.25,
      w: bp?.subtitleSlot?.w ?? (W - 1),
      h: bp?.subtitleSlot?.h ?? 0.4,
      fontSize: ss.fontSize,
      color: ss.color,
      fontFace: ss.fontFace,
      align: 'left',
      valign: 'middle',
    });
  }
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const bs = bodyStyleFromTheme(theme);
  if (slide.body || bullets.length) {
    const lines = bullets.length ? bullets : [slide.body];
    s.addText(lines.map((line, i) => ({
      text: String(line),
      options: {
        bullet: bullets.length > 0,
        breakLine: i < lines.length - 1,
        fontSize: bs.fontSize,
        color: bs.color,
        fontFace: bs.fontFace,
        paraSpaceAfter: 8,
      },
    })), {
      x: 0.8, y: panelY + 0.35, w: W - 1.6, h: Math.max(1.5, H - panelY - 0.8),
    });
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutSection(pptx, s, theme, slide) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  const ts = titleStyleFromTheme(theme);
  const ss = subtitleStyleFromTheme(theme);
  const bp = theme.blueprint;
  const titleBox = bp?.titleSlot || { x: 0.8, y: H * 0.35, w: W - 1.6, h: 0.9 };
  s.addText(slide.title || '', {
    x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h,
    fontSize: ts.fontSize || 32, bold: true, color: ts.color, fontFace: ts.fontFace,
    align: ts.align || 'left', valign: 'middle',
  });
  if (slide.subtitle || slide.body) {
    const subBox = bp?.subtitleSlot || { x: titleBox.x, y: titleBox.y + titleBox.h + 0.1, w: titleBox.w, h: 0.6 };
    s.addText(String(slide.subtitle || slide.body), {
      x: subBox.x, y: subBox.y, w: subBox.w, h: subBox.h,
      fontSize: ss.fontSize, color: ss.color, fontFace: ss.fontFace,
    });
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

/** Dense single-slide IC scheme snapshot: purpose + components table + rules + payout. */
function renderLayoutOnePager(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, {
    title: slide.title || 'IC Scheme One-Pager',
    subtitle: slide.subtitle || 'Scheme at a glance',
  });
  const top = contentTop(theme, true);
  const gap = 0.18;
  const leftW = (W - 1 - gap) * 0.58;
  const rightW = (W - 1 - gap) * 0.42;
  const panelH = H - top - 0.35;
  const bs = bodyStyleFromTheme(theme);
  const ct = cardTitleStyleFromTheme(theme);
  const accent = theme.accent || theme.bgDark || '4472C4';

  addPanel(pptx, s, theme, { x: 0.5, y: top, w: leftW, h: panelH });
  addPanel(pptx, s, theme, { x: 0.5 + leftW + gap, y: top, w: rightW, h: panelH });

  // Left: purpose + components table
  let y = top + 0.2;
  s.addText('Purpose', {
    x: 0.7, y, w: leftW - 0.4, h: 0.32,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });
  y += 0.35;
  if (slide.body) {
    s.addText(String(slide.body), {
      x: 0.7, y, w: leftW - 0.4, h: 0.7,
      fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, valign: 'top',
    });
    y += 0.75;
  }
  s.addText('Components & weightings', {
    x: 0.7, y, w: leftW - 0.4, h: 0.32,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });
  y += 0.38;

  const table = slide.tableData;
  if (table?.headers?.length && Array.isArray(table.rows)) {
    const colCount = table.headers.length;
    const tableW = leftW - 0.4;
    const colW = tableW / colCount;
    const headerRow = table.headers.map((h) => ({
      text: String(h ?? ''),
      options: { bold: true, color: theme.textOnDark || 'FFFFFF', fill: { color: accent }, align: 'center', valign: 'middle' },
    }));
    const bodyRows = table.rows.slice(0, 8).map((row, rowIdx) => {
      const cells = Array.isArray(row) ? row : [row];
      const rowFill = theme.contentTextLight || theme.cardTransparency > 0
        ? { color: 'FFFFFF', transparency: rowIdx % 2 === 0 ? 88 : 92 }
        : { color: rowIdx % 2 === 0 ? 'F8FAFC' : 'FFFFFF' };
      return Array.from({ length: colCount }, (_, i) => ({
        text: String(cells[i] ?? ''),
        options: { color: bs.color, fill: rowFill, align: 'left', valign: 'middle' },
      }));
    });
    s.addTable([headerRow, ...bodyRows], {
      x: 0.7, y, w: tableW, colW: Array(colCount).fill(colW),
      fontFace: bs.fontFace,
      fontSize: Math.max(10, (bs.fontSize || 13) - 2),
      color: bs.color,
      border: [
        { type: 'solid', pt: 0.5, color: theme.border || accent },
        { type: 'solid', pt: 0.5, color: theme.border || accent },
        { type: 'solid', pt: 0.5, color: theme.border || accent },
        { type: 'solid', pt: 0.5, color: theme.border || accent },
      ],
    });
  } else if (Array.isArray(slide.bullets) && slide.bullets.length) {
    s.addText(slide.bullets.slice(0, 6).map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < Math.min(5, slide.bullets.length - 1), fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 4 },
    })), { x: 0.7, y, w: leftW - 0.4, h: panelH - (y - top) - 0.25 });
  }

  // Right: rules + payout
  const rx = 0.5 + leftW + gap + 0.2;
  let ry = top + 0.2;
  s.addText('Key rules', {
    x: rx, y: ry, w: rightW - 0.4, h: 0.32,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });
  ry += 0.38;
  const rules = Array.isArray(slide.bulletsRight) && slide.bulletsRight.length
    ? slide.bulletsRight
    : (Array.isArray(slide.rules) ? slide.rules : []);
  if (rules.length) {
    const ruleH = Math.min(panelH * 0.45, 0.32 * rules.length + 0.2);
    s.addText(rules.slice(0, 6).map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < Math.min(5, rules.length - 1), fontSize: Math.max(10, (bs.fontSize || 13) - 1), color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 4 },
    })), { x: rx, y: ry, w: rightW - 0.4, h: ruleH });
    ry += ruleH + 0.2;
  }
  s.addText('Payout / mechanics', {
    x: rx, y: ry, w: rightW - 0.4, h: 0.32,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });
  ry += 0.38;
  const payout = slide.payout || slide.callout || '';
  const payoutBullets = Array.isArray(slide.payoutBullets) ? slide.payoutBullets : [];
  if (payout) {
    s.addText(String(payout), {
      x: rx, y: ry, w: rightW - 0.4, h: 0.9,
      fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, valign: 'top',
    });
    ry += 0.95;
  }
  if (payoutBullets.length) {
    s.addText(payoutBullets.slice(0, 4).map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < Math.min(3, payoutBullets.length - 1), fontSize: Math.max(10, (bs.fontSize || 13) - 1), color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 3 },
    })), { x: rx, y: ry, w: rightW - 0.4, h: Math.max(0.6, top + panelH - ry - 0.2) });
  }

  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutBullets(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  addPanel(pptx, s, theme, { x: 0.5, y: top, w: W - 1, h: H - top - 0.35 });
  const bs = bodyStyleFromTheme(theme);
  let y = top + 0.3;
  if (slide.body) {
    s.addText(String(slide.body), {
      x: 0.8, y, w: W - 1.6, h: 0.7,
      fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, valign: 'top',
    });
    y += 0.8;
  }
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  if (bullets.length) {
    s.addText(bullets.map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 7 },
    })), { x: 0.8, y, w: W - 1.6, h: Math.max(0.8, H - y - 0.5) });
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutCards(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const units = (bullets.length ? bullets : (slide.body ? [slide.body] : [])).map(splitBullet);
  const n = Math.min(5, Math.max(2, units.length || 2));
  const gap = 0.2;
  const side = 0.5;
  const cardW = (W - side * 2 - gap * (n - 1)) / n;
  const cardH = H - top - 0.35;
  const ct = cardTitleStyleFromTheme(theme);
  const bs = bodyStyleFromTheme(theme);
  const accent = theme.accent || theme.bgDark;

  for (let i = 0; i < n; i++) {
    const x = side + i * (cardW + gap);
    const unit = units[i] || { heading: null, body: '' };
    addPanel(pptx, s, theme, { x, y: top, w: cardW, h: cardH });
    if (accent) {
      s.addShape(pptx.shapes.RECTANGLE, {
        x, y: top, w: cardW, h: 0.08,
        fill: { color: accent },
        line: { color: accent },
      });
    }
    s.addText(unit.heading || `Point ${i + 1}`, {
      x: x + 0.15, y: top + 0.3, w: cardW - 0.3, h: 0.85,
      fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace, valign: 'top',
    });
    if (unit.body) {
      s.addText(String(unit.body), {
        x: x + 0.15, y: top + 1.25, w: cardW - 0.3, h: cardH - 1.5,
        fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, valign: 'top',
      });
    }
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutTable(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  addPanel(pptx, s, theme, { x: 0.5, y: top, w: W - 1, h: H - top - 0.35 });
  const bs = bodyStyleFromTheme(theme);
  let y = top + 0.25;
  if (slide.body) {
    s.addText(String(slide.body), {
      x: 0.75, y, w: W - 1.5, h: 0.55,
      fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace,
    });
    y += 0.65;
  }
  const table = slide.tableData;
  if (table?.headers?.length && Array.isArray(table.rows)) {
    const colCount = table.headers.length;
    const tableW = W - 1.5;
    const colW = tableW / colCount;
    const headerFill = theme.accent || theme.bgDark || '4472C4';
    const headerRow = table.headers.map((h) => ({
      text: String(h ?? ''),
      options: { bold: true, color: theme.textOnDark || 'FFFFFF', fill: { color: headerFill }, align: 'center', valign: 'middle' },
    }));
    const bodyRows = table.rows.slice(0, 12).map((row, rowIdx) => {
      const cells = Array.isArray(row) ? row : [row];
      const rowFill = theme.contentTextLight || theme.cardTransparency > 0
        ? { color: 'FFFFFF', transparency: rowIdx % 2 === 0 ? 88 : 92 }
        : { color: rowIdx % 2 === 0 ? 'F8FAFC' : 'FFFFFF' };
      return Array.from({ length: colCount }, (_, i) => ({
        text: String(cells[i] ?? ''),
        options: { color: bs.color, fill: rowFill, align: 'left', valign: 'middle' },
      }));
    });
    s.addTable([headerRow, ...bodyRows], {
      x: 0.75, y, w: tableW, colW: Array(colCount).fill(colW),
      fontFace: bs.fontFace,
      fontSize: Math.max(11, (bs.fontSize || 13) - 1),
      color: bs.color,
      border: [
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'CBD5E1' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'CBD5E1' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'CBD5E1' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'CBD5E1' },
      ],
    });
  } else {
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    if (bullets.length) {
      s.addText(bullets.map((b, i) => ({
        text: String(b),
        options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 6 },
      })), { x: 0.75, y, w: W - 1.5, h: H - y - 0.5 });
    }
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutTwoColumn(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  const gap = 0.25;
  const colW = (W - 1 - gap) / 2;
  const cardH = H - top - 0.35;
  const left = Array.isArray(slide.bullets) ? slide.bullets : [];
  const right = Array.isArray(slide.bulletsRight) ? slide.bulletsRight : [];
  const bs = bodyStyleFromTheme(theme);
  const ct = cardTitleStyleFromTheme(theme);

  addPanel(pptx, s, theme, { x: 0.5, y: top, w: colW, h: cardH });
  addPanel(pptx, s, theme, { x: 0.5 + colW + gap, y: top, w: colW, h: cardH });

  s.addText(slide.leftTitle || 'Overview', {
    x: 0.7, y: top + 0.25, w: colW - 0.4, h: 0.4,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });
  s.addText(slide.rightTitle || 'Detail', {
    x: 0.7 + colW + gap, y: top + 0.25, w: colW - 0.4, h: 0.4,
    fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace,
  });

  const writeList = (items, x, allowBody) => {
    if (!items.length && allowBody && slide.body) {
      s.addText(String(slide.body), {
        x, y: top + 0.75, w: colW - 0.4, h: cardH - 1,
        fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace,
      });
      return;
    }
    if (!items.length) return;
    s.addText(items.map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < items.length - 1, fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 6 },
    })), { x, y: top + 0.75, w: colW - 0.4, h: cardH - 1 });
  };
  writeList(left, 0.7, true);
  writeList(right, 0.7 + colW + gap, false);
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutProcess(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  const steps = (Array.isArray(slide.bullets) && slide.bullets.length
    ? slide.bullets
    : (slide.body ? String(slide.body).split(/\n+/).filter(Boolean) : [])).map(splitBullet);
  const n = Math.min(6, Math.max(2, steps.length || 2));
  const gap = 0.18;
  const side = 0.5;
  const boxW = (W - side * 2 - gap * (n - 1)) / n;
  const boxH = Math.min(3.8, H - top - 0.5);
  const bs = bodyStyleFromTheme(theme);
  const ct = cardTitleStyleFromTheme(theme);
  const accent = theme.accent || theme.bgDark || '4472C4';

  for (let i = 0; i < n; i++) {
    const x = side + i * (boxW + gap);
    const step = steps[i] || { heading: null, body: '' };
    addPanel(pptx, s, theme, { x, y: top, w: boxW, h: boxH });
    s.addShape(pptx.shapes.OVAL, {
      x: x + boxW / 2 - 0.28, y: top + 0.25, w: 0.56, h: 0.56,
      fill: { color: accent },
      line: { color: accent },
    });
    s.addText(String(i + 1), {
      x: x + boxW / 2 - 0.28, y: top + 0.25, w: 0.56, h: 0.56,
      fontSize: 16, bold: true, color: theme.textOnDark || 'FFFFFF', fontFace: ct.fontFace,
      align: 'center', valign: 'middle',
    });
    s.addText(step.heading || `Step ${i + 1}`, {
      x: x + 0.12, y: top + 1.0, w: boxW - 0.24, h: 0.7,
      fontSize: ct.fontSize, bold: true, color: ct.color, fontFace: ct.fontFace, align: 'center', valign: 'top',
    });
    if (step.body) {
      s.addText(String(step.body), {
        x: x + 0.12, y: top + 1.75, w: boxW - 0.24, h: boxH - 2.0,
        fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, align: 'center', valign: 'top',
      });
    }
    if (i < n - 1 && pptx.shapes.RIGHT_ARROW) {
      try {
        s.addShape(pptx.shapes.RIGHT_ARROW, {
          x: x + boxW + 0.02, y: top + boxH / 2 - 0.12, w: Math.max(0.12, gap - 0.04), h: 0.24,
          fill: { color: accent, transparency: 30 },
          line: { color: accent, transparency: 40 },
        });
      } catch { /* optional */ }
    }
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

function renderLayoutCallout(pptx, s, theme, slide, idx) {
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  addTitleAndSubtitle(pptx, s, theme, { title: slide.title || `Slide ${idx + 1}`, subtitle: slide.subtitle });
  const top = contentTop(theme, !!slide.subtitle);
  const accent = theme.accent || theme.bgDark || '4472C4';
  addPanel(pptx, s, theme, { x: 0.5, y: top, w: W - 1, h: H - top - 0.35 });
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0.5, y: top, w: 0.12, h: H - top - 0.35,
    fill: { color: accent },
    line: { color: accent },
  });
  const bs = bodyStyleFromTheme(theme);
  const ct = cardTitleStyleFromTheme(theme);
  let y = top + 0.4;
  if (slide.body) {
    s.addText(String(slide.body), {
      x: 1.0, y, w: W - 1.8, h: 1.4,
      fontSize: Math.max(ct.fontSize || 14, (bs.fontSize || 13) + 2),
      bold: true, color: ct.color, fontFace: ct.fontFace, valign: 'top',
    });
    y += 1.5;
  }
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  if (bullets.length) {
    s.addText(bullets.map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: bs.fontSize, color: bs.color, fontFace: bs.fontFace, paraSpaceAfter: 6 },
    })), { x: 1.0, y, w: W - 1.8, h: Math.max(0.8, H - y - 0.5) });
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

/** @deprecated use renderSlideFromTheme */
export function renderTitleSlide(pptx, theme, opts) {
  return renderSlideFromTheme(pptx, theme, { type: 'title', layout: 'title', ...opts }, 0);
}

/** @deprecated use renderSlideFromTheme */
export function renderContentSlide(pptx, theme, slide, idx) {
  return renderSlideFromTheme(pptx, theme, { type: 'content', ...slide }, idx);
}

export function applyPptxLayout(pptx, theme) {
  const width = theme.slideWidth || DEFAULT_PPTX_GENERATOR_THEME.slideWidth;
  const height = theme.slideHeight || DEFAULT_PPTX_GENERATOR_THEME.slideHeight;
  pptx.defineLayout({ name: 'USER_TEMPLATE', width, height });
  pptx.layout = 'USER_TEMPLATE';
}

export function applyTemplateChrome(pptx, slide, theme) {
  applyBrandChrome(pptx, slide, theme);
}
export function applyContentHeader() { return 1.2; }
