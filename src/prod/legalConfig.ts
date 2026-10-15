// Who the legal pages speak for. Set these in your build environment before launch (see docs/launch-checklist.md).
// Until VITE_LEGAL_REVIEWED=true the pages show a "draft" banner, because they are templates, not legal advice.

const env = import.meta.env;

export const LEGAL = {
  company: env.VITE_COMPANY_NAME || '[Company legal name]',
  address: env.VITE_COMPANY_ADDRESS || '[Registered address], Windhoek, Namibia',
  email: env.VITE_SUPPORT_EMAIL || '[support email]',
  phone: env.VITE_SUPPORT_PHONE || '[support phone]',
  reviewed: env.VITE_LEGAL_REVIEWED === 'true',
  updated: env.VITE_LEGAL_UPDATED || '[date]',
};

export type LegalPage = 'terms' | 'privacy' | 'refunds';

export const legalHref = (page: LegalPage): string => `?page=${page}`;

export const isLegalPage = (v: string | null): v is LegalPage => v === 'terms' || v === 'privacy' || v === 'refunds';
