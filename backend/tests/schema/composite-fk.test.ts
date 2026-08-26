import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, closePool } from '../helpers/db';

// ---------------------------------------------------------------------
// Composite FK enforcement probe.
//
// A plain `org_id` column proves nothing about whether a child row's org
// can drift from its parent's — that requires an insert that is otherwise
// entirely valid (every NOT NULL column populated, and the *plain* single-
// column reference — lead_id / job_id / message_id / converted_lead_id —
// pointing at a real row) where only the org_id disagrees with the
// parent's actual org. Each case below is checked two ways, matching the
// shape used in tenancy-columns.test.ts:
//   - negative: the mismatched-org insert is rejected with SQLSTATE 23503
//     (foreign_key_violation) specifically, not merely "rejected" — a
//     23502 (not_null_violation) or 23505 would pass a looser assertion
//     for the wrong reason, exactly the bug Task 2's review caught.
//   - positive control: the identical payload with the *matching* org_id
//     inserts successfully, proving the negative case fails only because
//     of the org mismatch and not because the payload is malformed.
// ---------------------------------------------------------------------

let orgA: string;
let orgB: string;
let leadA: string;
let leadB: string;
let jobA: string;
let messageA: string;

beforeAll(async () => {
  const a = await sql(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    ['FK Org A', `fk-org-a-${randomUUID()}`],
  );
  orgA = a.rows[0].id;

  const b = await sql(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    ['FK Org B', `fk-org-b-${randomUUID()}`],
  );
  orgB = b.rows[0].id;

  const lead = await sql(
    `INSERT INTO leads (company_name, source, org_id) VALUES ('FK Co A', 'manual', $1) RETURNING id`,
    [orgA],
  );
  leadA = lead.rows[0].id;

  const leadOther = await sql(
    `INSERT INTO leads (company_name, source, org_id) VALUES ('FK Co B', 'manual', $1) RETURNING id`,
    [orgB],
  );
  leadB = leadOther.rows[0].id;

  const job = await sql(
    `INSERT INTO jobs (company_name, org_id) VALUES ('FK Co A', $1) RETURNING id`,
    [orgA],
  );
  jobA = job.rows[0].id;

  const message = await sql(
    `INSERT INTO outreach_messages (lead_id, body, org_id) VALUES ($1, 'fk probe body', $2) RETURNING id`,
    [leadA, orgA],
  );
  messageA = message.rows[0].id;
});

afterAll(async () => {
  // Children before parents — several of these FKs are NO ACTION, not
  // CASCADE (outreach_history.message_id, jobs.converted_lead_id), so a
  // parent delete before its children are gone would fail.
  await sql(`DELETE FROM outreach_history WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM lead_signals    WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM lead_scores     WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM job_signals     WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM job_submissions WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM outreach_messages WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM jobs            WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM leads           WHERE org_id IN ($1, $2)`, [orgA, orgB]);
  await sql(`DELETE FROM organizations   WHERE id     IN ($1, $2)`, [orgA, orgB]);
  await closePool();
});

async function insertRow(table: string, columns: string[], values: unknown[]) {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  return sql(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
}

describe('lead children cannot disagree with their lead about org', () => {
  it('rejects a lead_signal in org B pointing at a lead in org A (23503)', async () => {
    await expect(
      insertRow('lead_signals', ['lead_id', 'signal_type', 'org_id'], [leadA, 'hiring', orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a lead_signal in the same org as its lead (positive control)', async () => {
    const r = await insertRow('lead_signals', ['lead_id', 'signal_type', 'org_id'], [leadA, 'hiring', orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM lead_signals WHERE id = $1`, [r.rows[0].id]);
  });

  it('rejects a lead_score in the wrong org (23503)', async () => {
    await expect(
      insertRow('lead_scores', ['lead_id', 'overall_score', 'org_id'], [leadA, 50, orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a lead_score in the matching org (positive control)', async () => {
    const r = await insertRow('lead_scores', ['lead_id', 'overall_score', 'org_id'], [leadA, 50, orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM lead_scores WHERE id = $1`, [r.rows[0].id]);
  });

  it('rejects an outreach_message in the wrong org (23503)', async () => {
    await expect(
      insertRow('outreach_messages', ['lead_id', 'body', 'org_id'], [leadA, 'hi', orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts an outreach_message in the matching org (positive control)', async () => {
    const r = await insertRow('outreach_messages', ['lead_id', 'body', 'org_id'], [leadA, 'hi', orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM outreach_messages WHERE id = $1`, [r.rows[0].id]);
  });

  it('rejects outreach_history in the wrong org (23503)', async () => {
    await expect(
      insertRow('outreach_history', ['lead_id', 'channel', 'org_id'], [leadA, 'email', orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts outreach_history in the matching org (positive control)', async () => {
    const r = await insertRow('outreach_history', ['lead_id', 'channel', 'org_id'], [leadA, 'email', orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM outreach_history WHERE id = $1`, [r.rows[0].id]);
  });
});

describe('job children cannot disagree with their job about org', () => {
  it('rejects a job_signal in the wrong org (23503)', async () => {
    await expect(
      insertRow('job_signals', ['job_id', 'org_id'], [jobA, orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a job_signal in the matching org (positive control)', async () => {
    const r = await insertRow('job_signals', ['job_id', 'org_id'], [jobA, orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM job_signals WHERE id = $1`, [r.rows[0].id]);
  });

  it('rejects a job_submission in the wrong org (23503)', async () => {
    await expect(
      insertRow('job_submissions', ['job_id', 'profile_label', 'org_id'], [jobA, 'Someone', orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a job_submission in the matching org (positive control)', async () => {
    const r = await insertRow('job_submissions', ['job_id', 'profile_label', 'org_id'], [jobA, 'Someone', orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM job_submissions WHERE id = $1`, [r.rows[0].id]);
  });
});

describe('cross-org references between siblings (nullable, MATCH SIMPLE)', () => {
  it('rejects a job in org B converted from a lead in org A (23503)', async () => {
    await expect(
      insertRow('jobs', ['company_name', 'converted_lead_id', 'org_id'], ['X', leadA, orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts a job converted from a lead in the same org (positive control)', async () => {
    const r = await insertRow('jobs', ['company_name', 'converted_lead_id', 'org_id'], ['X', leadA, orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM jobs WHERE id = $1`, [r.rows[0].id]);
  });

  it('accepts a job with no converted_lead_id at all (NULL skips the check)', async () => {
    const r = await insertRow('jobs', ['company_name', 'converted_lead_id', 'org_id'], ['X', null, orgB]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM jobs WHERE id = $1`, [r.rows[0].id]);
  });

  it('rejects outreach_history pointing at another org’s message (23503)', async () => {
    // lead_id = leadB (valid in orgB) isolates the failure to the
    // message_org_fkey — messageA belongs to orgA, not orgB.
    await expect(
      insertRow('outreach_history', ['lead_id', 'message_id', 'channel', 'org_id'], [leadB, messageA, 'email', orgB]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('accepts outreach_history pointing at a message in the same org (positive control)', async () => {
    const r = await insertRow('outreach_history', ['lead_id', 'message_id', 'channel', 'org_id'], [leadA, messageA, 'email', orgA]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM outreach_history WHERE id = $1`, [r.rows[0].id]);
  });

  it('accepts outreach_history with no message_id at all (NULL skips the check)', async () => {
    const r = await insertRow('outreach_history', ['lead_id', 'message_id', 'channel', 'org_id'], [leadB, null, 'email', orgB]);
    expect(r.rows).toHaveLength(1);
    await sql(`DELETE FROM outreach_history WHERE id = $1`, [r.rows[0].id]);
  });
});
