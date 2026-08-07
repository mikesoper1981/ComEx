import JSZip from 'jszip';

const EMU_PER_INCH = 914400;

/**
 * ComEx default look — used ONLY when the user has not uploaded a template.
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
  const m = xmlFragment.match(/<(?:\w+:)?alpha\b[^>]*\bval\s*=\s*"(\d+)"/i);
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
  const mime = mimeFromPath(mediaPath);
  if (!mime) return null;
  const buf = await file.async('uint8array');
  if (!buf?.length || buf.length > 6_000_000) return null;
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
  for (const run of runs) {
    const rPr = run.match(/<(?:\w+:)?rPr\b[^>]*>[\s\S]*?<\/(?:\w+:)?rPr>/i)?.[0]
      || run.match(/<(?:\w+:)?rPr\b[^>]*\/>/i)?.[0]
      || '';
    const size = halfPointsToPt((rPr.match(/\bsz\s*=\s*"(\d+)"/i) || [])[1]);
    const bold = /\bb\s*=\s*"(?:1|true)"/i.test(rPr);
    const font = (rPr.match(/latin[^>]*\btypeface\s*=\s*"([^"]+)"/i) || [])[1] || null;
    const color = extractFillColor(rPr, colors);
    const text = ((run.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    if (size || color || font) return { size, bold, font, color, sampleLen: text.length };
  }
  return null;
}

function collectParagraphTexts(block) {
  const paras = [...block.matchAll(/<(?:\w+:)?p\b[^>]*>[\s\S]*?<\/(?:\w+:)?p>/gi)].map((m) => m[0]);
  return paras.map((p) => {
    const parts = [...p.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    return parts.join('').trim();
  }).filter(Boolean);
}

/**
 * Build a full visual blueprint from the uploaded slide — every filled shape,
 * text slot (with live font/size/colour/position), background, and pictures.
 * Template wording is ignored; styles and layout are kept.
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

  const slidePaths = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => Number((a.match(/slide(\d+)/i) || [])[1] || 0) - Number((b.match(/slide(\d+)/i) || [])[1] || 0));

  if (!slidePaths.length) throw new Error('No slides found in this PowerPoint');

  const designSlidePath = slidePaths[0];
  const slideXml = await zip.file(designSlidePath).async('text');
  const relsPath = designSlidePath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = parseRels(zip.file(relsPath) ? await zip.file(relsPath).async('text') : '');
  const partDir = designSlidePath.split('/').slice(0, -1).join('/');

  let backgroundImage = null;
  const bgBlock = slideXml.match(/<(?:\w+:)?bg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?bg>/i)?.[1] || '';
  const bgEmbed = (bgBlock.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i) || [])[1];
  if (bgEmbed && rels[bgEmbed]) {
    const mediaPath = resolveZipPath(`${partDir}/file.xml`, rels[bgEmbed]);
    backgroundImage = await readMediaAsDataUrl(zip, mediaPath);
  }

  const chromeShapes = [];
  const textSlots = [];
  const shapes = [...slideXml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/gi)].map((m) => m[0]);

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

    if (fill) {
      chromeShapes.push({
        kind: 'shape',
        preset,
        ...geom,
        fill,
        transparency,
      });
    }

    if (style && (paras.length || style.size)) {
      textSlots.push({
        kind: 'text',
        ...geom,
        style: {
          fontSize: style.size,
          bold: !!style.bold,
          fontFace: style.font || null,
          color: style.color || null,
        },
        paragraphCount: Math.max(1, paras.length),
        // sample text length only — never used as export content
        _sampleLen: paras.join(' ').length,
      });
    }
  }

  // Pictures on the design slide (icons / logos) — keep positions for visual match
  const pictures = [];
  const picBlocks = [...slideXml.matchAll(/<(?:\w+:)?pic\b[^>]*>[\s\S]*?<\/(?:\w+:)?pic>/gi)].map((m) => m[0]);
  for (const block of picBlocks) {
    const embed = (block.match(/blip[^>]*\b(?:r:)?embed\s*=\s*"([^"]+)"/i) || [])[1];
    if (!embed || !rels[embed] || embed === bgEmbed) continue;
    const geom = shapeGeom(block);
    if (geom.w >= slideWidth * 0.85 && geom.h >= slideHeight * 0.85) continue;
    if (geom.w < 0.1 || geom.h < 0.1) continue;
    const mediaPath = resolveZipPath(`${partDir}/file.xml`, rels[embed]);
    const data = await readMediaAsDataUrl(zip, mediaPath);
    if (!data) continue;
    pictures.push({ kind: 'picture', data, ...geom });
  }

  // Classify text slots from geometry + relative size (not from wording)
  const slotsBySize = [...textSlots].sort((a, b) => (b.style.fontSize || 0) - (a.style.fontSize || 0));
  const titleSlot = slotsBySize.find((s) => s.y < slideHeight * 0.28 && (s.style.fontSize || 0) >= 18)
    || slotsBySize[0]
    || null;
  const subtitleSlot = textSlots
    .filter((s) => s !== titleSlot && s.y < slideHeight * 0.35 && s.w > slideWidth * 0.4)
    .sort((a, b) => a.y - b.y)[0]
    || null;

  const contentSlots = textSlots
    .filter((s) => s !== titleSlot && s !== subtitleSlot && s.y >= slideHeight * 0.28)
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));

  // Pair card title (higher, shorter) with card body (lower, taller) into columns
  const cardColumns = [];
  const used = new Set();
  const titleLike = contentSlots.filter((s) => s.h <= 1.2 && (s.style.fontSize || 0) >= 12);
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
  // leftover short content slots
  for (const s of contentSlots) {
    if (used.has(s)) continue;
    used.add(s);
    cardColumns.push({ title: s, body: null });
  }
  cardColumns.sort((a, b) => {
    const ax = a.title?.x ?? a.body?.x ?? 0;
    const bx = b.title?.x ?? b.body?.x ?? 0;
    return ax - bx;
  });

  const panelShapes = chromeShapes
    .filter((s) => s.area > 1.5 && s.w < slideWidth * 0.95)
    .sort((a, b) => a.x - b.x || a.y - b.y);

  const brandCandidates = [colors.accent1, colors.accent5, colors.dk2, ...chromeShapes.map((s) => s.fill)]
    .map(normalizeHex)
    .filter((c) => c && !isNearGrey(c) && !isLightHex(c));
  brandCandidates.sort((a, b) => colourScore(b) - colourScore(a));

  const titleStyle = titleSlot?.style || {};
  const subtitleStyle = subtitleSlot?.style || {};
  const cardTitleStyle = cardColumns.find((c) => c.title)?.title?.style || {};
  const cardBodyStyle = cardColumns.find((c) => c.body)?.body?.style || {};
  const panel = panelShapes[0];

  const contentTextLight = !!(
    (cardBodyStyle.color && isLightHex(cardBodyStyle.color))
    || (cardTitleStyle.color && isLightHex(cardTitleStyle.color))
    || (panel && panel.transparency >= 50)
  );

  const blueprint = {
    slideWidth,
    slideHeight,
    backgroundImage,
    chromeShapes,
    pictures,
    titleSlot,
    subtitleSlot,
    cardColumns,
    panelShapes,
  };

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
    backgroundImage,
    logos: pictures.filter((p) => {
      const inCorner = (p.x < slideWidth * 0.12 || p.x + p.w > slideWidth * 0.88)
        && (p.y < slideHeight * 0.15 || p.y + p.h > slideHeight * 0.85);
      return inCorner;
    }),
    blueprint,
    palette: {
      bgDark: brandCandidates[0] || colors.accent1 || null,
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
  };
}

export async function extractPptxThemeFromFile(file) {
  const buf = await file.arrayBuffer();
  return extractPptxThemeFromArrayBuffer(buf, file.name);
}

export function themeToSettingsMeta(extracted) {
  if (!extracted) return null;
  // Persist styles/layout metadata only — binary assets reload from storage on export
  const bp = extracted.blueprint;
  return {
    schemeName: extracted.schemeName,
    colors: extracted.colors,
    fonts: extracted.fonts,
    typography: extracted.typography,
    slideWidth: extracted.slideWidth,
    slideHeight: extracted.slideHeight,
    palette: extracted.palette,
    logoCount: Array.isArray(extracted.logos) ? extracted.logos.length : 0,
    hasBackgroundImage: !!extracted.backgroundImage,
    blueprintMeta: bp ? {
      chromeShapeCount: bp.chromeShapes?.length || 0,
      pictureCount: bp.pictures?.length || 0,
      cardColumnCount: bp.cardColumns?.length || 0,
      hasTitleSlot: !!bp.titleSlot,
      hasSubtitleSlot: !!bp.subtitleSlot,
    } : null,
    sampledSlides: extracted.sampledSlides || 0,
    sourceFileName: extracted.sourceFileName,
    extractedAt: extracted.extractedAt,
  };
}

export function resolvePptxGeneratorTheme(extracted) {
  if (!extracted?.blueprint && !extracted?.palette && !extracted?.colors) {
    return { ...DEFAULT_PPTX_GENERATOR_THEME };
  }
  // Template path: values come from the upload only (nulls stay null — renderer uses slot styles)
  const p = extracted.palette || {};
  const t = extracted.typography || {};
  const f = extracted.fonts || {};
  return {
    slideWidth: extracted.slideWidth,
    slideHeight: extracted.slideHeight,
    bgDark: normalizeHex(p.bgDark),
    bgLight: normalizeHex(p.cardFill),
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
    backgroundImage: extracted.backgroundImage || null,
    logos: Array.isArray(extracted.logos) ? extracted.logos : [],
    blueprint: extracted.blueprint || null,
    useDefaultChrome: false,
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

function applyBackground(slide, theme) {
  if (theme.backgroundImage) {
    try {
      slide.background = { data: theme.backgroundImage };
      return;
    } catch { /* fall through */ }
  }
  if (theme.bgDark) slide.background = { color: theme.bgDark };
  else if (theme.bgLight) slide.background = { color: theme.bgLight };
}

function fillFromShape(shape) {
  if (!shape?.fill) return { type: 'none' };
  if (shape.transparency > 0) return { color: shape.fill, transparency: shape.transparency };
  return { color: shape.fill };
}

function styleOpts(style = {}, fallback = {}) {
  return {
    fontSize: style?.fontSize || fallback.fontSize || null,
    bold: style?.bold ?? fallback.bold ?? false,
    color: style?.color || fallback.color || null,
    fontFace: style?.fontFace || fallback.fontFace || null,
  };
}

function paintBlueprintChrome(pptx, slide, blueprint) {
  if (!blueprint) return;
  for (const shape of blueprint.chromeShapes || []) {
    slide.addShape(pptxShapeName(pptx, shape.preset), {
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      fill: fillFromShape(shape),
      line: { color: shape.fill, transparency: Math.min(100, (shape.transparency || 0) + 5) },
      rectRadius: String(shape.preset || '').includes('round') ? 0.06 : 0,
    });
  }
  for (const pic of blueprint.pictures || []) {
    try {
      slide.addImage({ data: pic.data, x: pic.x, y: pic.y, w: pic.w, h: pic.h });
    } catch { /* skip */ }
  }
}

function splitBullet(text) {
  const s = String(text || '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < 48) {
    return { heading: s.slice(0, colon).trim(), body: s.slice(colon + 1).trim() };
  }
  return { heading: null, body: s };
}

/**
 * Render one slide by replaying the uploaded slide blueprint and filling its text slots.
 * When no blueprint exists, falls back to the ComEx default chrome only.
 */
export function renderSlideFromTheme(pptx, theme, slide, idx = 0) {
  if (theme?.blueprint && !theme.useDefaultChrome) {
    return renderFromBlueprint(pptx, theme, slide, idx);
  }
  return renderDefaultSlide(pptx, theme || DEFAULT_PPTX_GENERATOR_THEME, slide, idx);
}

function renderFromBlueprint(pptx, theme, slide, idx) {
  const bp = theme.blueprint;
  const s = pptx.addSlide();
  applyBackground(s, theme);
  paintBlueprintChrome(pptx, s, bp);

  const title = slide.title || (idx === 0 ? '' : `Slide ${idx + 1}`);
  const subtitle = slide.subtitle || '';
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const dataPoints = Array.isArray(slide.dataPoints) ? slide.dataPoints : [];
  const body = slide.body ? String(slide.body) : '';
  const table = slide.tableData;

  if (bp.titleSlot && title) {
    const st = styleOpts(bp.titleSlot.style, { fontSize: theme.titleFontSize, color: theme.textOnDark, fontFace: theme.headingFont, bold: true });
    s.addText(title, {
      x: bp.titleSlot.x, y: bp.titleSlot.y, w: bp.titleSlot.w, h: bp.titleSlot.h,
      fontSize: st.fontSize, bold: st.bold, color: st.color, fontFace: st.fontFace,
      align: 'left', valign: 'middle',
    });
  }

  if (bp.subtitleSlot && subtitle) {
    const st = styleOpts(bp.subtitleSlot.style, { fontSize: theme.subtitleFontSize, color: theme.subtitleColor, fontFace: theme.bodyFont });
    s.addText(String(subtitle), {
      x: bp.subtitleSlot.x, y: bp.subtitleSlot.y, w: bp.subtitleSlot.w, h: bp.subtitleSlot.h,
      fontSize: st.fontSize, bold: st.bold, color: st.color, fontFace: st.fontFace,
      align: 'left', valign: 'middle',
    });
  }

  const columns = bp.cardColumns || [];
  const hasTable = table && Array.isArray(table.headers) && Array.isArray(table.rows) && table.headers.length;

  // Build content units for columns: prefer structured bullets, else body / data points
  let units = [];
  if (bullets.length) {
    units = bullets.map((b) => splitBullet(b));
  } else if (dataPoints.length) {
    units = dataPoints.map((dp) => ({
      heading: dp.label || null,
      body: `${dp.value || ''}${dp.context ? ` (${dp.context})` : ''}`.trim(),
    }));
  } else if (body) {
    units = [{ heading: null, body }];
  }

  if (hasTable && columns.length) {
    // Use first column body area (or span of panels) for the table — styles from template body/accent
    const first = columns[0];
    const last = columns[columns.length - 1];
    const x = first.title?.x ?? first.body?.x ?? bp.panelShapes?.[0]?.x ?? 0.5;
    const y = first.title?.y ?? first.body?.y ?? bp.panelShapes?.[0]?.y ?? 1.8;
    const right = (last.body || last.title || bp.panelShapes?.[bp.panelShapes.length - 1] || { x: x + 4, w: 4 });
    const w = Math.max(2, (right.x + right.w) - x);
    const bodyStyle = styleOpts(first.body?.style || first.title?.style, {
      fontSize: theme.bodyFontSize,
      color: theme.textOnLight,
      fontFace: theme.bodyFont,
    });
    const headerFill = theme.accent || theme.bgDark;
    const colCount = table.headers.length;
    const colW = w / colCount;
    const headerRow = table.headers.map((h) => ({
      text: String(h ?? ''),
      options: {
        bold: true,
        color: theme.textOnDark || bodyStyle.color,
        fill: headerFill ? { color: headerFill } : undefined,
        align: 'center',
        valign: 'middle',
      },
    }));
    const bodyRows = table.rows.slice(0, 10).map((row) => {
      const cells = Array.isArray(row) ? row : [row];
      return Array.from({ length: colCount }, (_, i) => ({
        text: String(cells[i] ?? ''),
        options: { color: bodyStyle.color, align: 'left', valign: 'middle' },
      }));
    });
    // Optional intro body above table in title row of first column
    if (body && first.title) {
      const ts = styleOpts(first.title.style, { fontSize: theme.cardTitleFontSize, color: theme.textOnLight, fontFace: theme.cardHeadingFont, bold: true });
      s.addText(body, {
        x: first.title.x, y: first.title.y, w: w, h: first.title.h,
        fontSize: ts.fontSize, bold: ts.bold, color: ts.color, fontFace: ts.fontFace, valign: 'middle',
      });
    }
    s.addTable([headerRow, ...bodyRows], {
      x,
      y: y + (first.title ? first.title.h + 0.1 : 0),
      w,
      colW: Array(colCount).fill(colW),
      fontFace: bodyStyle.fontFace,
      fontSize: bodyStyle.fontSize,
      color: bodyStyle.color,
      border: [
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'FFFFFF' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'FFFFFF' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'FFFFFF' },
        { type: 'solid', pt: 0.5, color: theme.border || theme.accent || 'FFFFFF' },
      ],
    });
  } else if (columns.length && units.length) {
    const n = Math.min(columns.length, units.length);
    for (let i = 0; i < n; i++) {
      const col = columns[i];
      const unit = units[i];
      const titleStyle = styleOpts(col.title?.style, {
        fontSize: theme.cardTitleFontSize,
        color: theme.textOnLight,
        fontFace: theme.cardHeadingFont,
        bold: true,
      });
      const bodyStyle = styleOpts(col.body?.style, {
        fontSize: theme.cardBodyFontSize || theme.bodyFontSize,
        color: theme.textOnLight,
        fontFace: theme.bodyFont,
      });

      const heading = unit.heading || null;
      const bodyText = unit.body || '';

      if (col.title) {
        s.addText(heading || `Point ${i + 1}`, {
          x: col.title.x, y: col.title.y, w: col.title.w, h: col.title.h,
          fontSize: titleStyle.fontSize, bold: true, color: titleStyle.color, fontFace: titleStyle.fontFace, valign: 'top',
        });
      }

      if (col.body) {
        const textForBody = col.title
          ? bodyText
          : (heading && bodyText ? `${heading}: ${bodyText}` : (bodyText || heading || ''));
        if (!textForBody) continue;
        const lines = String(textForBody).split(/\n+/).map((l) => l.trim()).filter(Boolean);
        const use = lines.slice(0, Math.max(1, col.body.paragraphCount || 6));
        s.addText(use.map((line, li) => ({
          text: String(line),
          options: {
            bullet: use.length > 1,
            breakLine: li < use.length - 1,
            fontSize: bodyStyle.fontSize,
            color: bodyStyle.color,
            fontFace: bodyStyle.fontFace,
            paraSpaceAfter: 6,
          },
        })), {
          x: col.body.x, y: col.body.y, w: col.body.w, h: col.body.h,
          valign: 'top',
        });
      }
    }

    if (units.length > columns.length && columns.length) {
      const last = columns[columns.length - 1];
      const slot = last.body || last.title;
      if (slot) {
        const st = styleOpts(slot.style, { fontSize: theme.bodyFontSize, color: theme.textOnLight, fontFace: theme.bodyFont });
        const extra = units.slice(columns.length).map((u) => (u.heading ? `${u.heading}: ${u.body}` : u.body)).filter(Boolean);
        if (extra.length) {
          s.addText(extra.map((line, li) => ({
            text: String(line),
            options: { bullet: true, breakLine: li < extra.length - 1, fontSize: st.fontSize, color: st.color, fontFace: st.fontFace, paraSpaceAfter: 4 },
          })), {
            x: slot.x,
            y: slot.y + slot.h * 0.55,
            w: slot.w,
            h: slot.h * 0.4,
          });
        }
      }
    }
  } else if (body || bullets.length) {
    // No card columns — write into largest text area below subtitle using subtitle/body styles from template
    const slot = bp.subtitleSlot || bp.titleSlot;
    const y = slot ? slot.y + slot.h + 0.3 : 1.8;
    const st = styleOpts(bp.cardColumns?.[0]?.body?.style || bp.subtitleSlot?.style, {
      fontSize: theme.bodyFontSize,
      color: theme.textOnLight || theme.subtitleColor,
      fontFace: theme.bodyFont,
    });
    const lines = bullets.length ? bullets : [body];
    s.addText(lines.map((line, li) => ({
      text: String(line),
      options: { bullet: bullets.length > 0, breakLine: li < lines.length - 1, fontSize: st.fontSize, color: st.color, fontFace: st.fontFace, paraSpaceAfter: 6 },
    })), {
      x: 0.5, y, w: (bp.slideWidth || theme.slideWidth) - 1, h: (bp.slideHeight || theme.slideHeight) - y - 0.4,
    });
  }

  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

/** Default ComEx chrome — only when no user template is uploaded. */
function renderDefaultSlide(pptx, theme, slide, idx) {
  const s = pptx.addSlide();
  const W = theme.slideWidth || 10;
  const H = theme.slideHeight || 5.625;
  const isTitle = (slide.type === 'title') || idx === 0;
  s.background = { color: isTitle ? theme.bgDark : theme.bgLight };

  if (isTitle) {
    s.addText(slide.title || '', {
      x: 0.5, y: 1.8, w: W - 1, h: 1,
      fontSize: theme.titleFontSize || 28, bold: true, color: theme.textOnDark,
      fontFace: theme.headingFont || 'Calibri', align: 'center',
    });
    if (slide.subtitle) {
      s.addText(String(slide.subtitle), {
        x: 0.5, y: 2.9, w: W - 1, h: 0.5,
        fontSize: theme.subtitleFontSize || 14, color: theme.subtitleColor || theme.textOnDark,
        fontFace: theme.bodyFont || 'Calibri', align: 'center',
      });
    }
    return s;
  }

  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0, y: 0, w: W, h: 0.85,
    fill: { color: theme.bgDark }, line: { color: theme.bgDark },
  });
  s.addText(slide.title || `Slide ${idx + 1}`, {
    x: 0.5, y: 0.2, w: W - 1, h: 0.5,
    fontSize: 22, bold: true, color: theme.textOnDark, fontFace: theme.headingFont || 'Calibri', valign: 'middle',
  });

  let y = 1.2;
  const textColor = theme.textOnLight;
  const fontBody = theme.bodyFont || 'Calibri';
  const bodySize = theme.bodyFontSize || 14;

  if (slide.body) {
    s.addText(String(slide.body), {
      x: 0.5, y, w: W - 1, h: 0.7, fontSize: bodySize, color: textColor, fontFace: fontBody,
    });
    y += 0.8;
  }
  if (Array.isArray(slide.bullets) && slide.bullets.length) {
    s.addText(slide.bullets.map((b, i) => ({
      text: String(b),
      options: { bullet: true, breakLine: i < slide.bullets.length - 1, fontSize: bodySize, color: textColor, fontFace: fontBody, paraSpaceAfter: 6 },
    })), { x: 0.5, y, w: W - 1, h: H - y - 0.4 });
  }
  if (slide.notes) s.addNotes(String(slide.notes));
  return s;
}

/** @deprecated use renderSlideFromTheme */
export function renderTitleSlide(pptx, theme, opts) {
  return renderSlideFromTheme(pptx, theme, { type: 'title', ...opts }, 0);
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

export function applyTemplateChrome() { /* superseded */ }
export function applyContentHeader() { return 1.2; }
