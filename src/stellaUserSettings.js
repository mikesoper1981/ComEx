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

/** Scope key for stella_files.org_id — one registry partition per account. */
export function stellaOrgIdForUser(userId) {
  const id = String(userId || '').trim();
  return id ? `user:${id}` : 'default';
}
