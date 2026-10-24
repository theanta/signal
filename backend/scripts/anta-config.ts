import type { PlatformConfig } from '../../shared/types';

// ANTA's own settings, applied by create-org to the `anta` org only, so the
// production cutover keeps them. Every other tenant starts from the neutral
// DEFAULT_PLATFORM_CONFIG and fills in Settings.
export const ANTA_PLATFORM_CONFIG: PlatformConfig = {
  agency_name: 'ANTA',
  agency_location: 'Detroit, Michigan',
  agency_website: '',
  agency_tagline: 'Software consultancy specializing in operational modernization',
  services: [
    'SaaS development and React/Next.js systems',
    'AI automation systems and intelligent workflows',
    'Operational dashboards and internal tools',
    'CRM systems and AI-powered operational software',
    'Startup MVP development',
    'Workflow automation and process optimization',
  ],
  outreach_tone: 'intelligent, consultative, NOT salesy, operationally focused',
  cta_style: '15-min call',
  sign_off: 'ANTA Team',
  target_locations: ['Detroit', 'Michigan', 'MI', 'Dearborn', 'Warren', 'Troy', 'Ann Arbor', 'Livonia', 'Sterling Heights'],
  target_company_sizes: ['11-50', '51-200', '201-500'],
  target_industries: [],
  target_roles: [
    'operations manager', 'operations coordinator', 'data entry specialist',
    'software engineer', 'full stack developer',
  ],
  active_sources: ['linkedin', 'crunchbase', 'job_board', 'local_business'],
};
