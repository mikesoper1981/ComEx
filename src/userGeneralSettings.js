import { normalizeMemoryItems } from './chatMemory';

export const GENERAL_SETTINGS_DEFAULTS = {
  companyName: '',
  industry: '',
  role: '',
  currency: 'GBP',
  metrics: '',
  abbreviations: '',
  preferences: '',
  constraints: '',
  customContext: '',
  responseLength: 'standard',
  memoryEnabled: true,
};

export const RESPONSE_LENGTH_OPTIONS = [
  { id: 'executive', label: 'Executive' },
  { id: 'standard', label: 'Standard' },
  { id: 'teaching', label: 'Teaching' },
];

function storedLength(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'executive' || s === 'standard' || s === 'teaching') return s;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'standard';
  if (n <= 1) return 'executive';
  if (n === 2) return 'standard';
  return 'teaching';
}

function settingsFrom(doc) {
  if (!doc || typeof doc !== 'object') return {};
  if (doc.settings && typeof doc.settings === 'object') return doc.settings;
  return doc;
}

export function pickGeneralSettings(doc) {
  const raw = settingsFrom(doc);
  return {
    companyName: String(raw.companyName || ''),
    industry: String(raw.industry || ''),
    role: String(raw.role || ''),
    currency: String(raw.currency || GENERAL_SETTINGS_DEFAULTS.currency),
    metrics: String(raw.metrics || ''),
    abbreviations: String(raw.abbreviations || ''),
    preferences: String(raw.preferences || ''),
    constraints: String(raw.constraints || ''),
    customContext: String(raw.customContext || ''),
    responseLength: storedLength(raw.responseLength),
    memoryEnabled: raw.memoryEnabled !== false,
  };
}

export function pickMemoryItems(doc) {
  const raw = settingsFrom(doc);
  return normalizeMemoryItems(raw.memory);
}

export function mergeGeneralIntoDocument(existing, general, user, memory, extra = {}) {
  const prev = existing && typeof existing === 'object' ? existing : {};
  const prevSettings = prev.settings && typeof prev.settings === 'object'
    ? prev.settings
    : (() => {
        const { userId: _id, updatedAt: _at, settings: _s, userName: _n, ...fields } = prev;
        return fields;
      })();
  const settings = {
    ...prevSettings,
    ...pickGeneralSettings(general),
  };
  if (typeof general?.memoryEnabled === 'boolean') settings.memoryEnabled = general.memoryEnabled;
  if (Array.isArray(memory)) settings.memory = memory;
  if (extra.stellaBusinessContext) {
    settings.stellaBusinessContext = extra.stellaBusinessContext;
  }
  if (extra.stellaConnections) {
    settings.stellaConnections = extra.stellaConnections;
  }
  return {
    userId: user.id,
    userName: user.name,
    updatedAt: new Date().toISOString(),
    settings,
  };
}
