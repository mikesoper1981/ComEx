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
 * Build a full visual blueprint from the uploaded slide â€” every filled shape,
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
        // sample text length only â€” never used as export content
        _sampleLen: paras.join(' ').length,
      });
    }
  }

  // Pictures on the design slide (icons / logos) â€” keep positions for visual match
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
  // Persist styles/layout metadata only â€” binary assets reload from storage on export
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
  // Template path: values come from the upload only (nulls stay null â€” renderer uses slot styles)
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
function applyBackground(slide, theme, { layout } = {}) {
  if (theme.backgroundImage) {
    try {
      slide.background = { data: theme.backgroundImage };
      return;
    } catch { /* fall through */ }
  }
  if (theme.useDefaultChrome) {
    const dark = layout === 'title' || layout === 'section';
    slide.background = { color: dark ? (theme.bgDark || '1E2761') : (theme.bgLight || 'FFFFFF') };
    return;
  }
  if (theme.bgDark) slide.background = { color: theme.bgDark };
  else if (theme.bgLight) slide.background = { color: theme.bgLight };
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
  return styleOpts(theme.blueprint?.titleSlot?.style, {
    fontSize: theme.titleFontSize || 28,
    color: theme.textOnDark || 'FFFFFF',
    fontFace: theme.headingFont || 'Calibri',
    bold: theme.titleBold !== false,
  });
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
      align: 'left',
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
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: panelFill(theme),
    line: { color: theme.cardFill || 'FFFFFF', transparency: Math.min(95, (theme.cardTransparency || 0) + 5) },
    rectRadius: 0.06,
  });
}

function inferLayout(slide, idx) {
  const explicit = String(slide.layout || '').toLowerCase().trim();
  const allowed = new Set(['title', 'section', 'bullets', 'cards', 'table', 'two_column', 'process', 'callout']);
  if (allowed.has(explicit)) return explicit;

  const type = String(slide.type || '').toLowerCase();
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
 * Template supplies background, colours, fonts, panel shading.
 * Layout is chosen from slide.layout / content â€” not a clone of the template slide.
 */
export function renderSlideFromTheme(pptx, theme, slide, idx = 0) {
  const t = !theme || theme.useDefaultChrome
    ? { ...DEFAULT_PPTX_GENERATOR_THEME, ...(theme || {}) }
    : theme;
  const layout = inferLayout(slide, idx);
  const s = pptx.addSlide();
  applyBackground(s, t, { layout });

  if (layout === 'title') return renderLayoutTitle(pptx, s, t, slide);
  if (layout === 'section') return renderLayoutSection(pptx, s, t, slide);
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
  addPanel(pptx, s, theme, { x: 0.5, y: panelY, w: W - 1, h: Math.max(2.2, H - panelY - 0.4) });

  s.addText(slide.title || '', {
    x: bp?.titleSlot?.x ?? 0.5,
    y: bp?.titleSlot?.y ?? 0.45,
    w: bp?.titleSlot?.w ?? (W - 1),
    h: bp?.titleSlot?.h ?? 0.9,
    fontSize: ts.fontSize || 32,
    bold: true,
    color: ts.color,
    fontFace: ts.fontFace,
    align: 'left',
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
  s.addText(slide.title || '', {
    x: 0.8, y: H * 0.35, w: W - 1.6, h: 0.9,
    fontSize: ts.fontSize || 32, bold: true, color: ts.color, fontFace: ts.fontFace, align: 'left',
  });
  if (slide.subtitle || slide.body) {
    s.addText(String(slide.subtitle || slide.body), {
      x: 0.8, y: H * 0.35 + 1.0, w: W - 1.6, h: 0.6,
      fontSize: ss.fontSize, color: ss.color, fontFace: ss.fontFace,
    });
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

export function applyTemplateChrome() { /* superseded */ }
export function applyContentHeader() { return 1.2; }
