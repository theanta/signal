import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgId } from '../../shared/types';

/**
 * Everything a request needs to touch tenant data, as one value.
 *
 * The org id and the client travel together deliberately: `db` already carries
 * a JWT whose `org_id` claim equals `orgId`, so app-layer filter and RLS policy
 * cannot be given different orgs by a caller who threads one and forgets the
 * other.
 */
export interface TenantContext {
  orgId: OrgId;
  userId: string;
  db: SupabaseClient;
}
