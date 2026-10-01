import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';

export interface CreateOrgInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  agencyName?: string;
}

export interface CreateOrgResult {
  orgId: string;
  userId: string;
}

const MIN_PASSWORD_LENGTH = 12;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Onboard a design partner.
 *
 * The only sanctioned way to create an organization. It leaves the tenant able
 * to log in and immediately see their own identity rather than ANTA's — the
 * config row matters as much as the user row, because platform_config drives
 * both scraping targets and the sign-off on generated outreach.
 *
 * Runs as service_role: onboarding happens before any tenant exists, so there
 * is no TenantContext to run it in. There is no transaction over PostgREST, so
 * each later failure deletes what the earlier steps created — a half-built
 * tenant (an org with no admin, or an admin with no config and therefore
 * ANTA's identity) is worse than none.
 */
export async function createOrg(input: CreateOrgInput): Promise<CreateOrgResult> {
  if (input.adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Admin password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new Error(`Slug "${input.slug}" must be lowercase letters, digits and single hyphens`);
  }
  if (!input.name.trim() || !input.adminName.trim()) {
    throw new Error('Organization name and admin name are required');
  }
  const email = input.adminEmail.toLowerCase().trim();

  const { data: clash } = await supabaseAdmin
    .from('organizations').select('id').eq('slug', input.slug).maybeSingle();
  if (clash) {
    throw new Error(`An organization with slug "${input.slug}" already exists`);
  }

  const { data: emailTaken } = await supabaseAdmin
    .from('users').select('id').eq('email', email).maybeSingle();
  if (emailTaken) {
    // Emails are globally unique: one org per user.
    throw new Error(`A user with email ${email} already exists`);
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: input.name.trim(), slug: input.slug })
    .select('id')
    .single();
  if (orgError || !org) throw new Error(`Failed to create organization: ${orgError?.message}`);

  const passwordHash = await bcrypt.hash(input.adminPassword, 12);

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      name: input.adminName.trim(),
      role: 'admin',
      org_id: org.id,
    })
    .select('id')
    .single();

  if (userError || !user) {
    // An org with no admin is invisible to cron (which skips it) and unusable
    // by the partner.
    await supabaseAdmin.from('organizations').delete().eq('id', org.id);
    throw new Error(`Failed to create admin user: ${userError?.message}`);
  }

  const { error: configError } = await supabaseAdmin
    .from('platform_config')
    .insert({
      org_id: org.id,
      config: { ...DEFAULT_PLATFORM_CONFIG, agency_name: input.agencyName?.trim() || input.name.trim() },
    });

  if (configError) {
    // Without a config row the partner would log in and get ANTA's defaults —
    // ANTA's name on their outreach and ANTA's target locations on their
    // scrapes. Undo rather than leave that behind.
    await supabaseAdmin.from('users').delete().eq('id', user.id);
    await supabaseAdmin.from('organizations').delete().eq('id', org.id);
    throw new Error(`Failed to create platform_config: ${configError.message}`);
  }

  return { orgId: org.id, userId: user.id };
}

if (require.main === module) {
  const [name, slug, adminEmail, adminName, agencyName] = process.argv.slice(2);
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!name || !slug || !adminEmail || !adminName || !adminPassword) {
    console.error(
      'Usage: ADMIN_PASSWORD=<password> npm run create-org -- ' +
      '"<Org Name>" <slug> <admin@email> "<Admin Name>" ["<Agency Name>"]\n\n' +
      'The password comes from the environment so it stays out of shell history.',
    );
    process.exit(1);
  }

  createOrg({ name, slug, adminEmail, adminName, adminPassword, agencyName })
    .then(({ orgId, userId }) => {
      console.log(`Created org ${orgId} with admin user ${userId}.`);
      console.log('Send the partner their email and password over a secure channel.');
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
