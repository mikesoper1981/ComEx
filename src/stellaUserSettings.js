import { companySlug, resolveUserCompany } from './company';

/** Per-user Stella Insights settings (business context + connections). */

export const DEFAULT_STELLA_BUSINESS_CONTEXT = {
  companyName: '',
  industry: '',
  keyGoals: '',
  keyMetrics: '',
  terminology: '',
};

export const STELLA_CONNECTORS = [
  { id: 'salesforce', name: 'Salesforce' },
  { id: 'veeva', name: 'Veeva' },
  { id: 'sap', name: 'SAP' },
  { id: 'powerbi', name: 'Power BI' },
  { id: 'ga', name: 'Google Analytics' },
  { id: 'databricks', name: 'Databricks' },
];

export function mergeStellaBusinessContext(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    companyName: String(src.companyName || ''),
    industry: String(src.industry || ''),
    keyGoals: String(src.keyGoals || ''),
    keyMetrics: String(src.keyMetrics || ''),
    terminology: String(src.terminology || ''),
  };
}

export function pickStellaBusinessContext(doc) {
  const raw = doc && typeof doc === 'object'
    ? (doc.settings && typeof doc.settings === 'object' ? doc.settings : doc)
    : {};
  return mergeStellaBusinessContext(raw.stellaBusinessContext);
}

export function stellaBusinessContextIsEmpty(ctx) {
  const c = mergeStellaBusinessContext(ctx);
  return !c.companyName && !c.industry && !c.keyGoals && !c.keyMetrics && !c.terminology;
}

/** Company, industry, metrics, and terminology belong in General user settings. */
export function liftStellaGenericIntoUserSettings(settings) {
  const s = settings && typeof settings === 'object' ? { ...settings } : {};
  const biz = mergeStellaBusinessContext(s.stellaBusinessContext);
  let changed = false;
  const take = (dest, src) => {
    if (!String(s[dest] || '').trim() && String(src || '').trim()) {
      s[dest] = String(src).trim();
      changed = true;
    }
  };
  take('companyName', biz.companyName);
  take('industry', biz.industry);
  take('abbreviations', biz.terminology);
  take('metrics', biz.keyMetrics);
  if (biz.companyName || biz.industry || biz.keyMetrics || biz.terminology) changed = true;
  s.stellaBusinessContext = mergeStellaBusinessContext({ keyGoals: biz.keyGoals });
  return { settings: s, changed };
}

/** Scope key for stella_files.org_id — company + user, never shared across tenants. */
export function stellaOrgIdForUser(userOrId) {
  if (userOrId && typeof userOrId === 'object') {
    const id = String(userOrId.id || '').trim();
    const slug = companySlug(resolveUserCompany(userOrId));
    return id ? `company:${slug}:user:${id}` : `company:${slug}`;
  }
  const id = String(userOrId || '').trim();
  return id ? `user:${id}` : 'default';
}

export function stellaOrgIdCandidates(user) {
  const id = String(user?.id || '').trim();
  return [...new Set([
    stellaOrgIdForUser(user),
    id ? `user:${id}` : '',
  ].filter(Boolean))];
}

export const STELLA_SCHEDULE_FREQUENCIES = ['hourly', 'daily', 'weekly'];

export function defaultStellaInboxSchedule() {
  return {
    id: 'inbox',
    source: 'inbox',
    enabled: false,
    frequency: 'daily',
    lastRunAt: '',
    lastStatus: '',
    lastFile: '',
    lastInboxAt: '',
  };
}

function normalizeScheduleFrequency(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'hourly' || s === 'weekly' || s === 'daily') return s;
  return 'daily';
}

export function mergeStellaSchedule(raw, fallbackId = 'inbox') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = defaultStellaInboxSchedule();
  return {
    ...base,
    id: String(src.id || fallbackId || base.id),
    source: String(src.source || base.source),
    enabled: src.enabled === true,
    frequency: normalizeScheduleFrequency(src.frequency),
    lastRunAt: String(src.lastRunAt || ''),
    lastStatus: String(src.lastStatus || ''),
    lastFile: String(src.lastFile || ''),
    lastInboxAt: String(src.lastInboxAt || ''),
  };
}

export function mergeStellaSchedules(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const merged = list.map((row, i) => mergeStellaSchedule(row, row?.id || `sched_${i + 1}`));
  if (!merged.some((s) => s.id === 'inbox' || s.source === 'inbox')) {
    merged.unshift(defaultStellaInboxSchedule());
  }
  return merged;
}

export function mergeStellaConnections(raw = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...src,
    schedules: mergeStellaSchedules(src.schedules),
  };
}

export function stellaInboxSchedule(connections) {
  const list = mergeStellaConnections(connections).schedules;
  return list.find((s) => s.id === 'inbox' || s.source === 'inbox') || defaultStellaInboxSchedule();
}

/** Drop folder for scheduled CSV/Excel/JSON, matched by company name. */
export function stellaInboxStoragePrefix(userOrName) {
  const company = companySlug(
    userOrName && typeof userOrName === 'object'
      ? resolveUserCompany(userOrName)
      : userOrName,
  );
  return `companies/${company}/stella/inbox/`;
}

export function stellaProcessedStoragePrefix(userOrName, dayIso) {
  const day = String(dayIso || new Date().toISOString()).slice(0, 10);
  return stellaInboxStoragePrefix(userOrName).replace(/inbox\/$/, `processed/${day}/`);
}
