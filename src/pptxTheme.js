import JSZip from 'jszip';

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
  schemeName: 'ComEx Default',
  sourceFileName: null,
};

function normalizeHex(val) {
  if (!val) return null;
  const h = String(val).replace(/^#/, '').trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(h)) return h;
  if (/^[0-9A-F]{8}$/.test(h)) return h.slice(2); // AARRGGBB → RRGGBB
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

/** Pull srgbClr / sysClr lastClr from a theme slot XML block. */
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

function extractLatinFont(themeXml, which /* majorFont | minorFont */) {
  const re = new RegExp(
    `<(?:\\w+:)?${which}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${which}>`,
    'i'
  );
  const block = themeXml.match(re);
  if (!block) return null;
  const latin = block[1].match(/<(?:\w+:)?latin\b[^>]*\btypeface\s*=\s*"([^"]+)"/i);
  return latin ? latin[1].trim() : null;
}

function extractSchemeName(themeXml) {
  const m = themeXml.match(/<(?:\w+:)?clrScheme\b[^>]*\bname\s*=\s*"([^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Read ONLY theme look/feel from a PPTX (colors + fonts).
 * Slide content / masters text are intentionally ignored.
 */
export async function extractPptxThemeFromArrayBuffer(arrayBuffer, fileName = null) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const themePath = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .find((n) => /^ppt\/theme\/theme\d+\.xml$/i.test(n));

  if (!themePath) {
    throw new Error('No theme found in this PowerPoint (ppt/theme/theme1.xml missing)');
  }

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

  return {
    schemeName: extractSchemeName(themeXml) || 'Custom',
    colors,
    fonts,
    sourceFileName: fileName || null,
    extractedAt: new Date().toISOString(),
  };
}

export async function extractPptxThemeFromFile(file) {
  const buf = await file.arrayBuffer();
  return extractPptxThemeFromArrayBuffer(buf, file.name);
}

/**
 * Map extracted OOXML theme → colours/fonts used by our slide generator.
 */
export function resolvePptxGeneratorTheme(extracted) {
  if (!extracted?.colors) return { ...DEFAULT_PPTX_GENERATOR_THEME };

  const c = extracted.colors;
  const bgDark = c.dk2 || c.dk1 || DEFAULT_PPTX_GENERATOR_THEME.bgDark;
  const bgLight = c.lt1 || DEFAULT_PPTX_GENERATOR_THEME.bgLight;
  const accent = c.accent1 || c.accent2 || DEFAULT_PPTX_GENERATOR_THEME.accent;

  // Text colours that contrast with the surfaces we paint.
  const textOnDark = isLightHex(bgDark)
    ? (c.dk1 || DEFAULT_PPTX_GENERATOR_THEME.textOnLight)
    : (isLightHex(c.lt1) ? c.lt1 : 'FFFFFF');
  const textOnDarkMuted = c.lt2 && !isLightHex(bgDark)
    ? c.lt2
    : (isLightHex(bgDark) ? (c.dk2 || '334155') : 'CADCFC');
  const textOnLight = isLightHex(bgLight)
    ? (c.dk1 || c.dk2 || DEFAULT_PPTX_GENERATOR_THEME.textOnLight)
    : (c.lt1 || 'FFFFFF');
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
    schemeName: extracted.schemeName || 'Custom',
    sourceFileName: extracted.sourceFileName || null,
  };
}

export function getPptxGeneratorThemeFromUserSettings(userSettings) {
  const tpl = userSettings?.pptxTemplate;
  if (tpl?.theme?.colors) {
    return resolvePptxGeneratorTheme(tpl.theme);
  }
  return { ...DEFAULT_PPTX_GENERATOR_THEME };
}
