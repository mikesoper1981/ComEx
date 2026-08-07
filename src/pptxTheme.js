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
  titleBold: true,
  headingBold: true,
  schemeName: 'ComEx Default',
  sourceFileName: null,
  titleBackground: null,
  contentBackground: null,
  logos: [],
  accentShapes: [],
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
  const latin = block[1].match(/<(?:\w+:)?latin\b[^>]*\btypeface\s*=\s*"([^"]+)"/i);
  return latin ? latin[1].trim() : null;
}

function extractSchemeName(themeXml) {
  const m = themeXml.match(/<(?:\w+:)?clrScheme\b[^>]*\bname\s*=\s*"([^"]+)"/i);
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
  if (lower.endsWith('.emf') || lower.endsWith('.wmf')) return null; // unsupported in browser pptxgen
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
  if (!buf?.length || buf.length > 4_500_000) return null; // skip huge assets
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
  // gradient → approximate with first stop
  const grad = block.match(/gradFill[\s\S]*?(srgbClr|schemeClr|sysClr)[^>]*>/i);
  if (grad) {
    const c = extractFillColor(grad[0], colors);
    if (c) return { type: 'solid', color: c };
  }
  return null;
}

function extractPlaceholderTypography(xml, colors) {
  const result = {
    titleFontSize: null,
    titleBold: null,
    titleColor: null,
    headingFontSize: null,
    bodyFontSize: null,
    bodyColor: null,
  };
  if (!xml) return result;

  // Prefer title / ctrTitle placeholder blocks
  const titleBlocks = [...xml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)]
    .map((m) => m[0])
    .filter((block) => /ph\b[^>]*\btype\s*=\s*"(?:title|ctrTitle)"/i.test(block));

  for (const block of titleBlocks) {
    const sz = block.match(/defRPr[^>]*\bsz\s*=\s*"(\d+)"/i) || block.match(/<\w*:?rPr[^>]*\bsz\s*=\s*"(\d+)"/i);
    if (sz && !result.titleFontSize) result.titleFontSize = halfPointsToPt(sz[1]);
    if (/\bbold\s*=\s*"(?:1|true)"/i.test(block)) result.titleBold = true;
    const col = extractFillColor(block.match(/defRPr[\s\S]{0,400}/i)?.[0] || block, colors);
    if (col) result.titleColor = col;
  }

  const bodyBlocks = [...xml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)]
    .map((m) => m[0])
    .filter((block) => /ph\b[^>]*\btype\s*=\s*"(?:body|subTitle|obj)"/i.test(block) || /ph\b[^>]*\btype\s*=\s*"body"/i.test(block));

  for (const block of bodyBlocks) {
    const sz = block.match(/lvl1pPr[\s\S]{0,200}?defRPr[^>]*\bsz\s*=\s*"(\d+)"/i)
      || block.match(/defRPr[^>]*\bsz\s*=\s*"(\d+)"/i);
    if (sz && !result.bodyFontSize) result.bodyFontSize = halfPointsToPt(sz[1]);
    const col = extractFillColor(block.match(/defRPr[\s\S]{0,400}/i)?.[0] || '', colors);
    if (col && !result.bodyColor) result.bodyColor = col;
  }

  // Fallback: any large defRPr on the master
  if (!result.titleFontSize) {
    const sizes = [...xml.matchAll(/\bsz\s*=\s*"(\d+)"/gi)].map((m) => halfPointsToPt(m[1])).filter(Boolean);
    const big = sizes.filter((s) => s >= 24).sort((a, b) => b - a)[0];
    if (big) result.titleFontSize = big;
    const mid = sizes.filter((s) => s >= 16 && s < 28).sort((a, b) => b - a)[0];
    if (mid) result.headingFontSize = mid;
  }

  return result;
}

function extractPics(xml) {
  if (!xml) return [];
  const pics = [];
  const blocks = [...xml.matchAll(/<(?:\w+:)?pic\b[^>]*>[\s\S]*?<\/(?:\w+:)?pic>/gi)].map((m) => m[0]);
  for (const block of blocks) {
    const embed = block.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i);
    if (!embed) continue;
    const xfrm = block.match(/<(?:\w+:)?xfrm\b[^>]*>[\s\S]*?<\/(?:\w+:)?xfrm>/i)?.[0] || block;
    const x = emuToInches((xfrm.match(/\bx\s*=\s*"(-?\d+)"/i) || [])[1]);
    const y = emuToInches((xfrm.match(/\by\s*=\s*"(-?\d+)"/i) || [])[1]);
    const w = emuToInches((xfrm.match(/\bcx\s*=\s*"(\d+)"/i) || [])[1]);
    const h = emuToInches((xfrm.match(/\bcy\s*=\s*"(\d+)"/i) || [])[1]);
    // Keep logos / marks; skip full-bleed images (treated as backgrounds separately)
    if (w >= SLIDE_W_IN * 0.92 && h >= SLIDE_H_IN * 0.92) continue;
    if (w < 0.15 || h < 0.15) continue;
    pics.push({ embedId: embed[1], x, y, w, h });
  }
  return pics;
}

/** Thin accent / brand bars from master shapes (solid rectangles). */
function extractAccentShapes(xml, colors) {
  if (!xml) return [];
  const shapes = [];
  const blocks = [...xml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)].map((m) => m[0]);
  for (const block of blocks) {
    if (/<(?:\w+:)?ph\b/i.test(block)) continue; // placeholders
    if (/<(?:\w+:)?pic\b/i.test(block)) continue;
    const off = block.match(/<(?:\w+:)?off\b[^>]*\bx\s*=\s*"(-?\d+)"[^>]*\by\s*=\s*"(-?\d+)"/i);
    const ext = block.match(/<(?:\w+:)?ext\b[^>]*\bcx\s*=\s*"(\d+)"[^>]*\bcy\s*=\s*"(\d+)"/i);
    if (!off || !ext) continue;
    const x = emuToInches(off[1]);
    const y = emuToInches(off[2]);
    const w = emuToInches(ext[1]);
    const h = emuToInches(ext[2]);
    const fill = extractFillColor(block.match(/solidFill[\s\S]{0,300}/i)?.[0] || '', colors);
    if (!fill) continue;
    // accent bars / side rails / header strips — skip large panels
    const area = w * h;
    if (area > 18 || area < 0.05) continue;
    const isBar = w >= 8 && h <= 1.2 || h >= 4 && w <= 0.5 || w >= 0.3 && h >= 0.08 && area < 6;
    if (!isBar) continue;
    shapes.push({ x, y, w, h, color: fill });
  }
  return shapes.slice(0, 8);
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

function pickLayoutPaths(zipFiles) {
  const layouts = Object.keys(zipFiles).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(n));
  const title = layouts.find((n) => /layout1/i.test(n)) || layouts[0];
  // Prefer a non-title layout for content when available
  const content = layouts.find((n) => n !== title) || title;
  return { titleLayout: title, contentLayout: content };
}

/**
 * Full style pack from a PPTX: theme colours/fonts, typography, master/layout
 * backgrounds, logos, and accent shapes. Slide *text content* is ignored.
 */
export async function extractPptxThemeFromArrayBuffer(arrayBuffer, fileName = null) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = zip.files;

  const themePath = Object.keys(files).filter((n) => !files[n].dir).find((n) => /^ppt\/theme\/theme\d+\.xml$/i.test(n));
  if (!themePath) throw new Error('No theme found in this PowerPoint (ppt/theme/theme1.xml missing)');

  const themeXml = await zip.file(themePath).async('text');
  const slots = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  const colors = {};
  for (const slot of slots) {
    const hex = extractSlotColor(themeXml, slot);
    if (hex) colors[slot] = hex;
  }
  if (!colors.dk1 && !colors.dk2 && !colors.accent1) {
    throw new Error('Could not read colour scheme from the PowerPoint theme');
  }

  const fonts = {
    heading: extractLatinFont(themeXml, 'majorFont') || 'Calibri',
    body: extractLatinFont(themeXml, 'minorFont') || extractLatinFont(themeXml, 'majorFont') || 'Calibri',
  };

  const masterPath = Object.keys(files).find((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(n));
  const { titleLayout, contentLayout } = pickLayoutPaths(files);

  const readPart = async (path) => {
    if (!path || !zip.file(path)) return { xml: '', rels: {} };
    const xml = await zip.file(path).async('text');
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('text') : '';
    return { xml, rels: parseRels(relsXml), path };
  };

  const master = await readPart(masterPath);
  const titleLay = await readPart(titleLayout);
  const contentLay = await readPart(contentLayout);

  const typoMaster = extractPlaceholderTypography(master.xml, colors);
  const typoTitle = extractPlaceholderTypography(titleLay.xml, colors);
  const typoContent = extractPlaceholderTypography(contentLay.xml, colors);

  const typography = {
    titleFontSize: typoTitle.titleFontSize || typoMaster.titleFontSize || 36,
    titleBold: typoTitle.titleBold ?? typoMaster.titleBold ?? true,
    titleColor: typoTitle.titleColor || typoMaster.titleColor || null,
    headingFontSize: typoContent.headingFontSize || typoContent.titleFontSize || typoMaster.headingFontSize || 22,
    bodyFontSize: typoContent.bodyFontSize || typoMaster.bodyFontSize || 14,
    bodyColor: typoContent.bodyColor || typoMaster.bodyColor || null,
  };

  let titleBg = extractBackground(titleLay.xml, colors) || extractBackground(master.xml, colors);
  let contentBg = extractBackground(contentLay.xml, colors) || extractBackground(master.xml, colors);

  const hydrateBg = async (bg, preferPart, fallbackPart) => {
    if (!bg) return null;
    if (bg.type === 'solid') return bg;
    const part = (preferPart.rels[bg.embedId] && preferPart) || (fallbackPart?.rels[bg.embedId] && fallbackPart) || preferPart;
    return hydrateBackground(bg, part.rels, zip, part.path);
  };

  const titleBackground = await hydrateBg(titleBg, titleLay, master);
  const contentBackground = await hydrateBg(contentBg, contentLay, master);

  const masterLogos = await hydratePics(extractPics(master.xml), master.rels, zip, master.path);
  const layoutLogosTitle = await hydratePics(extractPics(titleLay.xml), titleLay.rels, zip, titleLay.path);
  const layoutLogosContent = await hydratePics(extractPics(contentLay.xml), contentLay.rels, zip, contentLay.path);

  // Dedupe logos roughly by position/size
  const logos = [];
  const seen = new Set();
  for (const logo of [...masterLogos, ...layoutLogosContent, ...layoutLogosTitle]) {
    const key = `${logo.x.toFixed(2)}_${logo.y.toFixed(2)}_${logo.w.toFixed(2)}_${logo.h.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    logos.push(logo);
  }

  const accentShapes = [
    ...extractAccentShapes(master.xml, colors),
    ...extractAccentShapes(contentLay.xml, colors),
  ].slice(0, 10);

  return {
    schemeName: extractSchemeName(themeXml) || 'Custom',
    colors,
    fonts,
    typography,
    titleBackground,
    contentBackground,
    logos,
    accentShapes,
    sourceFileName: fileName || null,
    extractedAt: new Date().toISOString(),
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
    logoCount: Array.isArray(extracted.logos) ? extracted.logos.length : 0,
    hasTitleBackgroundImage: extracted.titleBackground?.type === 'image',
    hasContentBackgroundImage: extracted.contentBackground?.type === 'image',
    accentShapeCount: Array.isArray(extracted.accentShapes) ? extracted.accentShapes.length : 0,
    sourceFileName: extracted.sourceFileName,
    extractedAt: extracted.extractedAt,
  };
}

export function resolvePptxGeneratorTheme(extracted) {
  if (!extracted?.colors) return { ...DEFAULT_PPTX_GENERATOR_THEME };

  const c = extracted.colors;
  const bgDark = c.dk2 || c.dk1 || DEFAULT_PPTX_GENERATOR_THEME.bgDark;
  const bgLight = c.lt1 || DEFAULT_PPTX_GENERATOR_THEME.bgLight;
  const accent = c.accent1 || c.accent2 || DEFAULT_PPTX_GENERATOR_THEME.accent;
  const typo = extracted.typography || {};

  const textOnDark = typo.titleColor && !isLightHex(bgDark)
    ? typo.titleColor
    : (isLightHex(bgDark) ? (c.dk1 || DEFAULT_PPTX_GENERATOR_THEME.textOnLight) : (isLightHex(c.lt1) ? c.lt1 : 'FFFFFF'));
  const textOnDarkMuted = c.lt2 && !isLightHex(bgDark) ? c.lt2 : (isLightHex(bgDark) ? (c.dk2 || '334155') : 'CADCFC');
  const textOnLight = typo.bodyColor || (isLightHex(bgLight) ? (c.dk1 || c.dk2 || DEFAULT_PPTX_GENERATOR_THEME.textOnLight) : (c.lt1 || 'FFFFFF'));
  const textMuted = c.lt2 || DEFAULT_PPTX_GENERATOR_THEME.textMuted;

  return {
    bgDark,
    bgLight,
    accent,
    textOnDark: normalizeHex(textOnDark) || DEFAULT_PPTX_GENERATOR_THEME.textOnDark,
    textOnDarkMuted: normalizeHex(textOnDarkMuted) || DEFAULT_PPTX_GENERATOR_THEME.textOnDarkMuted,
    textOnLight: normalizeHex(textOnLight) || DEFAULT_PPTX_GENERATOR_THEME.textOnLight,
    textMuted: normalizeHex(textMuted) || DEFAULT_PPTX_GENERATOR_THEME.textMuted,
    border: c.lt2 || DEFAULT_PPTX_GENERATOR_THEME.border,
    headingFont: extracted.fonts?.heading || DEFAULT_PPTX_GENERATOR_THEME.headingFont,
    bodyFont: extracted.fonts?.body || DEFAULT_PPTX_GENERATOR_THEME.bodyFont,
    titleFontSize: typo.titleFontSize || DEFAULT_PPTX_GENERATOR_THEME.titleFontSize,
    headingFontSize: typo.headingFontSize || DEFAULT_PPTX_GENERATOR_THEME.headingFontSize,
    bodyFontSize: typo.bodyFontSize || DEFAULT_PPTX_GENERATOR_THEME.bodyFontSize,
    titleBold: typo.titleBold !== false,
    headingBold: true,
    schemeName: extracted.schemeName || 'Custom',
    sourceFileName: extracted.sourceFileName || null,
    titleBackground: extracted.titleBackground || null,
    contentBackground: extracted.contentBackground || null,
    logos: Array.isArray(extracted.logos) ? extracted.logos : [],
    accentShapes: Array.isArray(extracted.accentShapes) ? extracted.accentShapes : [],
  };
}

export function getPptxGeneratorThemeFromUserSettings(userSettings) {
  const tpl = userSettings?.pptxTemplate;
  if (tpl?.theme?.colors) {
    return resolvePptxGeneratorTheme(tpl.theme);
  }
  return { ...DEFAULT_PPTX_GENERATOR_THEME };
}

/**
 * Load the full style pack (including logo/background images) from Supabase
 * for generation. Falls back to metadata-only theme if download fails.
 */
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

/** Apply template background, accent shapes, and logos onto a PptxGenJS slide. */
export function applyTemplateChrome(pptx, slide, theme, { variant = 'content' } = {}) {
  const bg = variant === 'title' ? (theme.titleBackground || theme.contentBackground) : (theme.contentBackground || theme.titleBackground);

  if (bg?.type === 'image' && bg.data) {
    try {
      slide.background = { data: bg.data };
    } catch {
      slide.background = { color: variant === 'title' ? theme.bgDark : theme.bgLight };
    }
  } else if (bg?.type === 'solid' && bg.color) {
    slide.background = { color: bg.color };
  } else {
    slide.background = { color: variant === 'title' ? theme.bgDark : theme.bgLight };
  }

  for (const shape of theme.accentShapes || []) {
    try {
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: shape.x, y: shape.y, w: shape.w, h: shape.h,
        fill: { color: shape.color },
        line: { color: shape.color },
      });
    } catch { /* skip bad shape */ }
  }

  for (const logo of theme.logos || []) {
    try {
      slide.addImage({ data: logo.data, x: logo.x, y: logo.y, w: logo.w, h: logo.h });
    } catch { /* skip bad image */ }
  }
}
