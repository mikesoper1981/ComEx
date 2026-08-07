import JSZip from 'jszip';

const EMU_PER_INCH = 914400;
const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;

/** Default ComEx deck look when no user template is uploaded. */
export const DEFAULT_PPTX_GENERATOR_THEME = {
  bgDark: '1E2761',
  bgLight: 'FFFFFF',
  accent: '60A5FA',
  textOnDark: 'FFFFFF',
  textOnDarkMuted: 'CADCFC',
  textOnLight: '1E2761',
  textMuted: '94A3B8',
  border: 'CBD5E1',
  headingFont: 'Calibri',
  bodyFont: 'Calibri',
  titleFontSize: 36,
  headingFontSize: 22,
  bodyFontSize: 14,
  subtitleFontSize: 18,
  titleBold: true,
  headingBold: true,
  schemeName: 'ComEx Default',
  sourceFileName: null,
  titleBackground: null,
  contentBackground: null,
  logos: [],
  accentShapes: [],
  headerBand: { x: 0, y: 0, w: 10, h: 0.88 },
  useDefaultChrome: true,
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
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 28; // low saturation
}

function colourScore(hex) {
  // Prefer saturated brand colours over greys/black/white.
  const h = normalizeHex(hex);
  if (!h) return -1;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = hexLuminance(h);
  // Mid-dark saturated blues/teals score high
  return sat * 2 + (lum > 0.15 && lum < 0.75 ? 1 : 0) + (b > r && b >= g ? 0.5 : 0);
}

function emuToInches(emu) {
  const n = Number(emu);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / EMU_PER_INCH) * 1000) / 1000;
}

function halfPointsToPt(sz) {
  const n = Number(sz);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / 100);
}

function colorFromSlotBlock(block) {
  if (!block) return null;
  const srgb = block.match(/srgbClr[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (srgb) return normalizeHex(srgb[1]);
  const sys = block.match(/sysClr[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (sys) return normalizeHex(sys[1]);
  return null;
}

function extractSlotColor(themeXml, slot) {
  const re = new RegExp(`<(?:\\w+:)?${slot}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${slot}>`, 'i');
  const m = themeXml.match(re);
  return m ? colorFromSlotBlock(m[1]) : null;
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
    dk1: colors.dk1, dark1: colors.dk1,
    lt1: colors.lt1, light1: colors.lt1,
    dk2: colors.dk2, dark2: colors.dk2,
    lt2: colors.lt2, light2: colors.lt2,
    accent1: colors.accent1, accent2: colors.accent2, accent3: colors.accent3,
    accent4: colors.accent4, accent5: colors.accent5, accent6: colors.accent6,
    tx1: colors.dk1, tx2: colors.dk2, bg1: colors.lt1, bg2: colors.lt2,
  };
  return map[key] || null;
}

function extractFillColor(xmlFragment, colors) {
  if (!xmlFragment) return null;
  // Prefer explicit srgb over scheme (scheme often resolves to grey/black)
  const srgb = xmlFragment.match(/srgbClr[^>]*\bval\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (srgb) return normalizeHex(srgb[1]);
  const sys = xmlFragment.match(/sysClr[^>]*\blastClr\s*=\s*"([0-9A-Fa-f]{6,8})"/i);
  if (sys) return normalizeHex(sys[1]);
  const scheme = xmlFragment.match(/schemeClr[^>]*\bval\s*=\s*"([^"]+)"/i);
  if (scheme) return resolveSchemeColor(scheme[1], colors);
  return null;
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
  const mime = mimeFromPath(mediaPath);
  if (!mime) return null;
  const buf = await file.async('uint8array');
  if (!buf?.length || buf.length > 4_500_000) return null;
  return `data:${mime};base64,${uint8ToBase64(buf)}`;
}

function extractBackground(xml, colors) {
  if (!xml) return null;
  const bg = xml.match(/<(?:\w+:)?bg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?bg>/i);
  if (!bg) return null;
  const block = bg[1];
  const embed = block.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i);
  if (embed) return { type: 'image', embedId: embed[1] };
  const solid = extractFillColor(block, colors);
  if (solid) return { type: 'solid', color: solid };
  const grad = block.match(/gradFill[\s\S]{0,800}/i);
  if (grad) {
    const c = extractFillColor(grad[0], colors);
    if (c) return { type: 'solid', color: c };
  }
  return null;
}

function shapeGeometry(block) {
  const xfrm = block.match(/<(?:\w+:)?xfrm\b[^>]*>[\s\S]*?<\/(?:\w+:)?xfrm>/i)?.[0] || '';
  const x = emuToInches((xfrm.match(/\bx\s*=\s*"(-?\d+)"/i) || [])[1]);
  const y = emuToInches((xfrm.match(/\by\s*=\s*"(-?\d+)"/i) || [])[1]);
  const w = emuToInches((xfrm.match(/\bcx\s*=\s*"(\d+)"/i) || [])[1]);
  const h = emuToInches((xfrm.match(/\bcy\s*=\s*"(\d+)"/i) || [])[1]);
  return { x, y, w, h, area: w * h };
}

/** Mine completed slides for real fills + text styling (not just theme placeholders). */
function analyzeSlideXml(xml, colors) {
  const fills = []; // {color, area, x, y, w, h, role}
  const texts = []; // {color, size, bold, font, roleHint}
  if (!xml) return { fills, texts, background: null, pics: [] };

  const background = extractBackground(xml, colors);

  // Full-bleed / large solid shapes often ARE the visual background or header.
  const shapes = [...xml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)].map((m) => m[0]);
  for (const block of shapes) {
    const isPh = /<(?:\w+:)?ph\b/i.test(block);
    const phType = (block.match(/ph\b[^>]*\btype\s*=\s*"([^"]+)"/i) || [])[1] || '';
    const geom = shapeGeometry(block);
    const fillFrag = block.match(/<(?:\w+:)?solidFill\b[\s\S]*?<\/(?:\w+:)?solidFill>/i)?.[0]
      || block.match(/<(?:\w+:)?gradFill\b[\s\S]*?<\/(?:\w+:)?gradFill>/i)?.[0]
      || '';
    const fill = extractFillColor(fillFrag, colors);
    if (fill && geom.area > 0.05) {
      let role = 'shape';
      if (geom.w >= SLIDE_W_IN * 0.9 && geom.h >= SLIDE_H_IN * 0.9) role = 'slideFill';
      else if (geom.y < 1.2 && geom.w >= 8 && geom.h <= 1.6) role = 'headerBand';
      else if (geom.x < 0.4 && geom.h >= 4 && geom.w <= 0.6) role = 'sideRail';
      else if (geom.area > 4 && !isLightHex(fill)) role = 'panel';
      fills.push({ color: fill, ...geom, role, isPh, phType });
    }

    // Text runs inside this shape
    const runs = [...block.matchAll(/<(?:\w+:)?r\b[^>]*>[\s\S]*?<\/(?:\w+:)?r>/gi)].map((m) => m[0]);
    for (const run of runs) {
      const rPr = run.match(/<(?:\w+:)?rPr\b[^>]*\/?>/i)?.[0]
        || run.match(/<(?:\w+:)?rPr\b[^>]*>[\s\S]*?<\/(?:\w+:)?rPr>/i)?.[0]
        || '';
      const sz = halfPointsToPt((rPr.match(/\bsz\s*=\s*"(\d+)"/i) || [])[1]);
      const bold = /\bb\s*=\s*"(?:1|true)"/i.test(rPr) || /<(?:\w+:)?b\s*\/>/i.test(rPr);
      const font = (rPr.match(/latin[^>]*\btypeface\s*=\s*"([^"]+)"/i) || [])[1] || null;
      const color = extractFillColor(rPr, colors) || extractFillColor(run.match(/solidFill[\s\S]{0,250}/i)?.[0] || '', colors);
      const text = (run.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/i) || [])[1] || '';
      if (!sz && !color) continue;
      let roleHint = 'body';
      if (/title|ctrTitle/i.test(phType) || (sz && sz >= 28)) roleHint = 'title';
      else if (/subTitle/i.test(phType) || (sz && sz >= 18 && sz < 28)) roleHint = 'subtitle';
      else if (sz && sz >= 16 && sz < 22) roleHint = 'heading';
      texts.push({
        color: color || null,
        size: sz,
        bold,
        font,
        roleHint,
        phType,
        len: text.replace(/<[^>]+>/g, '').trim().length,
      });
    }

    // Placeholder defaults (even without runs)
    if (isPh) {
      const def = block.match(/defRPr[^>]*>/i)?.[0] || block.match(/defRPr[\s\S]{0,400}/i)?.[0] || '';
      const sz = halfPointsToPt((def.match(/\bsz\s*=\s*"(\d+)"/i) || block.match(/\bsz\s*=\s*"(\d+)"/i) || [])[1]);
      const color = extractFillColor(def, colors);
      const font = (def.match(/latin[^>]*\btypeface\s*=\s*"([^"]+)"/i) || [])[1] || null;
      if (sz || color) {
        let roleHint = 'body';
        if (/title|ctrTitle/i.test(phType)) roleHint = 'title';
        else if (/subTitle/i.test(phType)) roleHint = 'subtitle';
        else if (/body|obj/i.test(phType)) roleHint = 'body';
        texts.push({ color, size: sz, bold: /title/i.test(phType), font, roleHint, phType, len: 0 });
      }
    }
  }

  const pics = [];
  const picBlocks = [...xml.matchAll(/<(?:\w+:)?pic\b[^>]*>[\s\S]*?<\/(?:\w+:)?pic>/gi)].map((m) => m[0]);
  for (const block of picBlocks) {
    const embed = block.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i);
    if (!embed) continue;
    const geom = shapeGeometry(block);
    if (geom.w >= SLIDE_W_IN * 0.92 && geom.h >= SLIDE_H_IN * 0.92) continue;
    if (geom.w < 0.15 || geom.h < 0.15) continue;
    pics.push({ embedId: embed[1], ...geom });
  }

  return { fills, texts, background, pics };
}

function pickBestFill(fills, predicate) {
  const list = fills.filter(predicate);
  if (!list.length) return null;
  list.sort((a, b) => (colourScore(b.color) * b.area) - (colourScore(a.color) * a.area));
  return list[0];
}

function pickTextStyle(texts, role) {
  const list = texts.filter((t) => t.roleHint === role && (t.color || t.size));
  if (!list.length) return null;
  // Prefer runs that actually have content, then larger size
  list.sort((a, b) => (b.len - a.len) || ((b.size || 0) - (a.size || 0)));
  const withColor = list.find((t) => t.color) || list[0];
  const withSize = list.find((t) => t.size) || list[0];
  const withFont = list.find((t) => t.font) || list[0];
  return {
    color: withColor.color || null,
    size: withSize.size || null,
    bold: list.some((t) => t.bold),
    font: withFont.font || null,
  };
}

function inferDesignFromAnalyses(analyses, themeColors) {
  const fills = analyses.flatMap((a) => a.fills);
  const texts = analyses.flatMap((a) => a.texts);

  const slideFill = pickBestFill(fills, (f) => f.role === 'slideFill')
    || (analyses.map((a) => a.background).find((b) => b?.type === 'solid') && {
      color: analyses.map((a) => a.background).find((b) => b?.type === 'solid')?.color,
    });

  const headerBand = pickBestFill(fills, (f) => f.role === 'headerBand')
    || pickBestFill(fills, (f) => f.y < 1.3 && f.w >= 7 && f.h <= 1.8 && !isLightHex(f.color));

  const brandPanel = pickBestFill(fills, (f) => !isLightHex(f.color) && !isNearGrey(f.color) && f.area >= 1)
    || pickBestFill(fills, (f) => !isLightHex(f.color) && f.area >= 1);

  const accent = pickBestFill(fills, (f) => f.role === 'sideRail' || (f.area < 3 && f.area > 0.08 && !isNearGrey(f.color) && colourScore(f.color) > 1))
    || pickBestFill(fills, (f) => !isNearGrey(f.color) && colourScore(f.color) > 1.2 && f.color !== brandPanel?.color);

  const lightBg = pickBestFill(fills, (f) => isLightHex(f.color) && f.area > 2)
    || { color: themeColors.lt1 || 'FFFFFF' };

  const titleStyle = pickTextStyle(texts, 'title');
  const subtitleStyle = pickTextStyle(texts, 'subtitle');
  const headingStyle = pickTextStyle(texts, 'heading');
  const bodyStyle = pickTextStyle(texts, 'body');

  // Brand / header colour: prefer saturated dark-ish fill from real slides over theme greys
  const candidates = [headerBand?.color, brandPanel?.color, themeColors.accent1, themeColors.dk2, themeColors.dk1]
    .map(normalizeHex)
    .filter(Boolean);
  candidates.sort((a, b) => colourScore(b) - colourScore(a));
  let bgDark = candidates[0] || DEFAULT_PPTX_GENERATOR_THEME.bgDark;
  // If we somehow still got near-black/grey but a blue accent exists, prefer accent for brand bar
  if (isNearGrey(bgDark) || hexLuminance(bgDark) < 0.08) {
    const colorful = [headerBand?.color, brandPanel?.color, accent?.color, themeColors.accent1]
      .map(normalizeHex).filter((c) => c && !isNearGrey(c));
    colorful.sort((a, b) => colourScore(b) - colourScore(a));
    if (colorful[0]) bgDark = colorful[0];
  }

  const bgLight = normalizeHex(slideFill?.color) && isLightHex(slideFill.color)
    ? slideFill.color
    : (normalizeHex(lightBg?.color) || themeColors.lt1 || 'FFFFFF');

  const accentColor = normalizeHex(accent?.color) && !isNearGrey(accent.color)
    ? accent.color
    : (normalizeHex(themeColors.accent1) || DEFAULT_PPTX_GENERATOR_THEME.accent);

  // Title text: white/light on dark headers is common for blue templates
  let textOnDark = normalizeHex(titleStyle?.color);
  if (!textOnDark || (!isLightHex(textOnDark) && !isLightHex(bgDark))) {
    textOnDark = isLightHex(bgDark) ? (themeColors.dk1 || '1E2761') : 'FFFFFF';
  }
  // If title is white and header is blue — good. Force white when header is dark.
  if (!isLightHex(bgDark) && textOnDark && !isLightHex(textOnDark) && colourScore(bgDark) > 1) {
    textOnDark = 'FFFFFF';
  }

  let textOnLight = normalizeHex(bodyStyle?.color) || normalizeHex(headingStyle?.color);
  if (!textOnLight || (isLightHex(bgLight) && isLightHex(textOnLight))) {
    textOnLight = themeColors.dk1 || '1E293B';
  }

  const textOnDarkMuted = normalizeHex(subtitleStyle?.color) && isLightHex(subtitleStyle.color)
    ? subtitleStyle.color
    : (isLightHex(bgDark) ? textOnLight : 'E2E8F0');

  const decorative = fills
    .filter((f) => ['headerBand', 'sideRail', 'panel'].includes(f.role) || (f.area < 8 && f.area > 0.08 && !f.isPh))
    .filter((f) => f.area < 20)
    .slice(0, 12)
    .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, color: f.color }));

  return {
    bgDark,
    bgLight,
    accent: accentColor,
    textOnDark,
    textOnDarkMuted,
    textOnLight,
    textMuted: isLightHex(bgLight) ? '64748B' : '94A3B8',
    border: themeColors.lt2 || 'CBD5E1',
    headingFont: titleStyle?.font || headingStyle?.font || null,
    bodyFont: bodyStyle?.font || subtitleStyle?.font || null,
    titleFontSize: titleStyle?.size || 36,
    headingFontSize: headingStyle?.size || titleStyle?.size || 22,
    subtitleFontSize: subtitleStyle?.size || 18,
    bodyFontSize: bodyStyle?.size || 14,
    titleBold: titleStyle?.bold !== false,
    headerBand: headerBand
      ? { x: headerBand.x, y: headerBand.y, w: headerBand.w, h: headerBand.h, color: headerBand.color || bgDark }
      : { x: 0, y: 0, w: 10, h: 0.88, color: bgDark },
    accentShapes: decorative,
    contentBackgroundSolid: bgLight,
    titleBackgroundSolid: (!isLightHex(bgDark) ? bgDark : null),
  };
}

async function hydrateBackground(bg, rels, zip, partPath) {
  if (!bg) return null;
  if (bg.type === 'solid') return bg;
  if (bg.type === 'image' && bg.embedId) {
    const target = rels[bg.embedId];
    if (!target) return null;
    const partDir = partPath.split('/').slice(0, -1).join('/');
    const resolved = resolveZipPath(`${partDir}/file.xml`, target);
    const data = await readMediaAsDataUrl(zip, resolved);
    if (data) return { type: 'image', data };
  }
  return null;
}

async function hydratePics(pics, rels, zip, partPath) {
  const partDir = partPath.split('/').slice(0, -1).join('/');
  const out = [];
  for (const pic of pics) {
    const target = rels[pic.embedId];
    if (!target) continue;
    const resolved = resolveZipPath(`${partDir}/file.xml`, target);
    const data = await readMediaAsDataUrl(zip, resolved);
    if (!data) continue;
    out.push({ data, x: pic.x, y: pic.y, w: pic.w, h: pic.h });
  }
  return out;
}

/**
 * Extract design from theme + slide masters/layouts + completed slides.
 * Completed-slide fills/text win over grey theme scheme defaults.
 */
export async function extractPptxThemeFromArrayBuffer(arrayBuffer, fileName = null) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = zip.files;

  const themePath = Object.keys(files).filter((n) => !files[n].dir).find((n) => /^ppt\/theme\/theme\d+\.xml$/i.test(n));
  const colors = {};
  let fonts = { heading: 'Calibri', body: 'Calibri' };
  let schemeName = 'Custom';
  let themeXml = '';

  if (themePath) {
    themeXml = await zip.file(themePath).async('text');
    for (const slot of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
      const hex = extractSlotColor(themeXml, slot);
      if (hex) colors[slot] = hex;
    }
    fonts = {
      heading: extractLatinFont(themeXml, 'majorFont') || 'Calibri',
      body: extractLatinFont(themeXml, 'minorFont') || extractLatinFont(themeXml, 'majorFont') || 'Calibri',
    };
    schemeName = extractSchemeName(themeXml) || 'Custom';
  }

  const readPart = async (path) => {
    if (!path || !zip.file(path)) return { xml: '', rels: {}, path };
    const xml = await zip.file(path).async('text');
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('text') : '';
    return { xml, rels: parseRels(relsXml), path };
  };

  const slidePaths = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
      return na - nb;
    })
    .slice(0, 8); // sample first slides — enough for design language

  const masterPath = Object.keys(files).find((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(n));
  const layoutPaths = Object.keys(files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(n)).slice(0, 4);

  const parts = [];
  for (const p of [masterPath, ...layoutPaths, ...slidePaths].filter(Boolean)) {
    parts.push(await readPart(p));
  }

  if (!parts.length) throw new Error('No slides or masters found in this PowerPoint');

  const analyses = parts.map((p) => analyzeSlideXml(p.xml, colors));
  // Prefer completed slides for inference (last N parts that are slides)
  const slideAnalyses = [];
  for (let i = 0; i < parts.length; i++) {
    if (/\/slides\/slide\d+\.xml$/i.test(parts[i].path)) slideAnalyses.push(analyses[i]);
  }
  const inferSource = slideAnalyses.length ? slideAnalyses : analyses;
  const inferred = inferDesignFromAnalyses(inferSource, colors);

  // Logos from master + layouts + first slides
  const logos = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const hydrated = await hydratePics(analyses[i].pics, parts[i].rels, zip, parts[i].path);
    for (const logo of hydrated) {
      const key = `${logo.x.toFixed(2)}_${logo.y.toFixed(2)}_${logo.w.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      logos.push(logo);
    }
  }

  // Backgrounds: prefer image from first title-ish slide / master, else inferred solid
  let titleBackground = null;
  let contentBackground = null;
  for (let i = 0; i < parts.length; i++) {
    const bg = analyses[i].background;
    if (!bg) continue;
    const hydrated = await hydrateBackground(bg, parts[i].rels, zip, parts[i].path);
    if (!hydrated) continue;
    if (!titleBackground) titleBackground = hydrated;
    contentBackground = hydrated;
  }
  if (!titleBackground && inferred.titleBackgroundSolid) {
    titleBackground = { type: 'solid', color: inferred.titleBackgroundSolid };
  }
  if (!contentBackground) {
    contentBackground = { type: 'solid', color: inferred.contentBackgroundSolid || inferred.bgLight };
  }

  return {
    schemeName,
    colors,
    fonts: {
      heading: inferred.headingFont || fonts.heading,
      body: inferred.bodyFont || fonts.body,
    },
    typography: {
      titleFontSize: inferred.titleFontSize,
      headingFontSize: inferred.headingFontSize,
      subtitleFontSize: inferred.subtitleFontSize,
      bodyFontSize: inferred.bodyFontSize,
      titleBold: inferred.titleBold,
      titleColor: inferred.textOnDark,
      bodyColor: inferred.textOnLight,
    },
    inferred,
    titleBackground,
    contentBackground,
    logos: logos.slice(0, 10),
    accentShapes: inferred.accentShapes,
    headerBand: inferred.headerBand,
    sourceFileName: fileName || null,
    extractedAt: new Date().toISOString(),
    sampledSlides: slidePaths.length,
  };
}

export async function extractPptxThemeFromFile(file) {
  const buf = await file.arrayBuffer();
  return extractPptxThemeFromArrayBuffer(buf, file.name);
}

/** Lightweight metadata for settings.json (no large base64 blobs). */
export function themeToSettingsMeta(extracted) {
  if (!extracted) return null;
  return {
    schemeName: extracted.schemeName,
    colors: extracted.colors,
    fonts: extracted.fonts,
    typography: extracted.typography,
    inferred: extracted.inferred
      ? {
          bgDark: extracted.inferred.bgDark,
          bgLight: extracted.inferred.bgLight,
          accent: extracted.inferred.accent,
          textOnDark: extracted.inferred.textOnDark,
          textOnLight: extracted.inferred.textOnLight,
          titleFontSize: extracted.inferred.titleFontSize,
          headingFontSize: extracted.inferred.headingFontSize,
          bodyFontSize: extracted.inferred.bodyFontSize,
          subtitleFontSize: extracted.inferred.subtitleFontSize,
        }
      : null,
    logoCount: Array.isArray(extracted.logos) ? extracted.logos.length : 0,
    sampledSlides: extracted.sampledSlides || 0,
    hasTitleBackgroundImage: extracted.titleBackground?.type === 'image',
    hasContentBackgroundImage: extracted.contentBackground?.type === 'image',
    sourceFileName: extracted.sourceFileName,
    extractedAt: extracted.extractedAt,
  };
}

export function resolvePptxGeneratorTheme(extracted) {
  if (!extracted) return { ...DEFAULT_PPTX_GENERATOR_THEME };

  const inf = extracted.inferred || {};
  const typo = extracted.typography || {};
  const c = extracted.colors || {};

  // Prefer slide-inferred palette — avoids grey theme scheme colours
  const bgDark = normalizeHex(inf.bgDark) || normalizeHex(c.accent1) || normalizeHex(c.dk2) || DEFAULT_PPTX_GENERATOR_THEME.bgDark;
  const bgLight = normalizeHex(inf.bgLight) || normalizeHex(c.lt1) || DEFAULT_PPTX_GENERATOR_THEME.bgLight;
  const accent = normalizeHex(inf.accent) || normalizeHex(c.accent1) || DEFAULT_PPTX_GENERATOR_THEME.accent;

  return {
    bgDark,
    bgLight,
    accent,
    textOnDark: normalizeHex(inf.textOnDark) || normalizeHex(typo.titleColor) || DEFAULT_PPTX_GENERATOR_THEME.textOnDark,
    textOnDarkMuted: normalizeHex(inf.textOnDarkMuted) || DEFAULT_PPTX_GENERATOR_THEME.textOnDarkMuted,
    textOnLight: normalizeHex(inf.textOnLight) || normalizeHex(typo.bodyColor) || DEFAULT_PPTX_GENERATOR_THEME.textOnLight,
    textMuted: normalizeHex(inf.textMuted) || DEFAULT_PPTX_GENERATOR_THEME.textMuted,
    border: normalizeHex(inf.border) || c.lt2 || DEFAULT_PPTX_GENERATOR_THEME.border,
    headingFont: extracted.fonts?.heading || DEFAULT_PPTX_GENERATOR_THEME.headingFont,
    bodyFont: extracted.fonts?.body || DEFAULT_PPTX_GENERATOR_THEME.bodyFont,
    titleFontSize: typo.titleFontSize || inf.titleFontSize || DEFAULT_PPTX_GENERATOR_THEME.titleFontSize,
    headingFontSize: typo.headingFontSize || inf.headingFontSize || DEFAULT_PPTX_GENERATOR_THEME.headingFontSize,
    subtitleFontSize: typo.subtitleFontSize || inf.subtitleFontSize || DEFAULT_PPTX_GENERATOR_THEME.subtitleFontSize,
    bodyFontSize: typo.bodyFontSize || inf.bodyFontSize || DEFAULT_PPTX_GENERATOR_THEME.bodyFontSize,
    titleBold: typo.titleBold !== false,
    headingBold: true,
    schemeName: extracted.schemeName || 'Custom',
    sourceFileName: extracted.sourceFileName || null,
    titleBackground: extracted.titleBackground || (inf.titleBackgroundSolid ? { type: 'solid', color: inf.titleBackgroundSolid } : null),
    contentBackground: extracted.contentBackground || { type: 'solid', color: bgLight },
    logos: Array.isArray(extracted.logos) ? extracted.logos : [],
    accentShapes: Array.isArray(extracted.accentShapes) ? extracted.accentShapes : (inf.accentShapes || []),
    headerBand: extracted.headerBand || inf.headerBand || DEFAULT_PPTX_GENERATOR_THEME.headerBand,
    useDefaultChrome: false,
  };
}

export function getPptxGeneratorThemeFromUserSettings(userSettings) {
  const tpl = userSettings?.pptxTemplate;
  if (tpl?.theme?.inferred || tpl?.theme?.colors) {
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

/** Apply template background, header band, accent shapes, and logos. */
export function applyTemplateChrome(pptx, slide, theme, { variant = 'content' } = {}) {
  const bg = variant === 'title'
    ? (theme.titleBackground || theme.contentBackground)
    : (theme.contentBackground || theme.titleBackground);

  if (bg?.type === 'image' && bg.data) {
    try { slide.background = { data: bg.data }; }
    catch { slide.background = { color: variant === 'title' ? theme.bgDark : theme.bgLight }; }
  } else if (bg?.type === 'solid' && bg.color) {
    slide.background = { color: bg.color };
  } else {
    slide.background = { color: variant === 'title' ? theme.bgDark : theme.bgLight };
  }

  // Title slides: fill with brand colour when we inferred a dark brand bg
  if (variant === 'title' && theme.bgDark && !(bg?.type === 'image')) {
    slide.background = { color: theme.bgDark };
  }

  for (const shape of theme.accentShapes || []) {
    try {
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: shape.x, y: shape.y, w: shape.w, h: shape.h,
        fill: { color: shape.color },
        line: { color: shape.color },
      });
    } catch { /* skip */ }
  }

  for (const logo of theme.logos || []) {
    try {
      slide.addImage({ data: logo.data, x: logo.x, y: logo.y, w: logo.w, h: logo.h });
    } catch { /* skip */ }
  }
}

/** Draw content-slide header using inferred band colour (blue etc.), not grey defaults. */
export function applyContentHeader(pptx, slide, theme, titleText) {
  const band = theme.headerBand || { x: 0, y: 0, w: 10, h: 0.88, color: theme.bgDark };
  const fill = band.color || theme.bgDark;
  const hasBgImage = theme.contentBackground?.type === 'image';

  if (!hasBgImage) {
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: band.x ?? 0,
      y: band.y ?? 0,
      w: band.w ?? 10,
      h: Math.max(0.55, band.h ?? 0.88),
      fill: { color: fill },
      line: { color: fill },
    });
    if (theme.accent && theme.accent !== fill) {
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 0,
        y: (band.y ?? 0) + Math.max(0.55, band.h ?? 0.88),
        w: 10,
        h: 0.05,
        fill: { color: theme.accent },
        line: { color: theme.accent },
      });
    }
  }

  const titleY = hasBgImage ? 0.25 : (band.y ?? 0);
  const titleH = hasBgImage ? 0.7 : Math.max(0.55, band.h ?? 0.88);
  slide.addText(titleText || '', {
    x: 0.4,
    y: titleY,
    w: 9.2,
    h: titleH,
    fontSize: theme.headingFontSize || 22,
    bold: true,
    color: hasBgImage ? theme.textOnDark : theme.textOnDark,
    valign: 'middle',
    fontFace: theme.headingFont || 'Calibri',
  });

  return hasBgImage ? 1.1 : ((band.y ?? 0) + Math.max(0.55, band.h ?? 0.88) + 0.15);
}
