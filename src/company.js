/** Tenant company for storage paths and Stella Postgres schemas. */

export const DEFAULT_TENANT_COMPANY = 'PharmaCo';
export const ADMIN_TENANT_COMPANY = 'ComEx';

export function companySlug(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'company';
}

/** Postgres schema for a company's Stella tables (c_pharmaco, c_comex, …). */
export function companyPgSchema(name) {
  return `c_${companySlug(name)}`.slice(0, 63);
}

export function defaultCompanyForRole(role) {
  return String(role || '') === 'admin' ? ADMIN_TENANT_COMPANY : DEFAULT_TENANT_COMPANY;
}

export function resolveUserCompany(user) {
  const named = String(user?.company || '').trim();
  if (named) return named;
  return defaultCompanyForRole(user?.role);
}

export function isCompanyPgSchema(schema) {
  return /^c_[a-z0-9_]+$/.test(String(schema || ''));
}
