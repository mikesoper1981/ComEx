/** Tenant company for storage paths and Stella Postgres schemas. */

const DEFAULT_TENANT_COMPANY = 'PharmaCo';
const ADMIN_TENANT_COMPANY = 'ComEx';

function companySlug(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'company';
}

function companyPgSchema(name) {
  return `c_${companySlug(name)}`.slice(0, 63);
}

function defaultCompanyForRole(role) {
  return String(role || '') === 'admin' ? ADMIN_TENANT_COMPANY : DEFAULT_TENANT_COMPANY;
}

function resolveUserCompany(user) {
  const named = String(user?.company || '').trim();
  if (named) return named;
  return defaultCompanyForRole(user?.role);
}

function isCompanyPgSchema(schema) {
  return /^c_[a-z0-9_]+$/.test(String(schema || ''));
}

async function ensureCompanyPgSchema(companyOrSchema) {
  return require('./stella-db').ensureCompanyPgSchema(companyOrSchema);
}

async function ensureAllCompanySchemas(companies) {
  return require('./stella-db').ensureAllCompanySchemas(companies);
}

function userObjectPrefix(user) {
  const company = companySlug(resolveUserCompany(user));
  const raw = user && typeof user === 'object' ? (user.name || user.id) : user;
  const folder = String(raw || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'user';
  return `companies/${company}/users/${folder}`;
}

module.exports = {
  DEFAULT_TENANT_COMPANY,
  ADMIN_TENANT_COMPANY,
  companySlug,
  companyPgSchema,
  defaultCompanyForRole,
  resolveUserCompany,
  isCompanyPgSchema,
  ensureCompanyPgSchema,
  ensureAllCompanySchemas,
  userObjectPrefix,
};
