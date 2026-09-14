import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../../services/supabaseService';
import { closePool, sql } from '../helpers/db';
import { seedTwoOrgs, teardownSeed, TwoOrgs } from '../helpers/seed';

/**
 * Cross-tenant isolation for the jobs half of supabaseService.
 *
 * Same discipline as tests/isolation/leads.test.ts: every test proves BOTH
 * that org A cannot reach org B's row AND that org A can still reach its own.
 * Without the second half, every assertion here is equally satisfied by a
 * scope that matches nothing — which is precisely what a subtly wrong RLS
 * policy looks like in Task 14. Mutation-tested both ways: deleting
 * `.eq('org_id', ctx.orgId)` fails these, and pointing ctx.orgId at a
 * nonexistent org fails these.
 */

let orgs: TwoOrgs;

// A's second posting at the shared company. getJobWithIntel's related-jobs
// lookup must find this one and only this one.
let aSecondJobId: string;

beforeAll(async () => {
  orgs = await seedTwoOrgs();
  // Both orgs now hold a job at a company with the same name, which is what
  // getJobWithIntel's related-jobs lookup keys on.
  await sql(`UPDATE jobs SET company_name = 'Shared Co' WHERE org_id IN ($1, $2)`,
    [orgs.a.orgId, orgs.b.orgId]);

  const second = await sql(
    `INSERT INTO jobs (company_name, job_title, org_id) VALUES ('Shared Co', 'Second', $1) RETURNING id`,
    [orgs.a.orgId],
  );
  aSecondJobId = second.rows[0].id as string;
});

afterAll(async () => {
  await teardownSeed();
  await closePool();
});

describe('reads', () => {
  it('getJobs returns only the caller org’s jobs', async () => {
    const { data } = await db.getJobs(orgs.a.ctx);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(j => j.org_id === orgs.a.orgId)).toBe(true);
    expect(data.map(j => j.id)).not.toContain(orgs.b.jobId);
  });

  it('getJobs honours filters without widening the org scope', async () => {
    // Positive control: a filter that matches A's own seeded job must still
    // find it. Otherwise "B's job is absent" is also satisfied by a scope
    // that returns nothing to anybody.
    const mine = await db.getJobs(orgs.a.ctx, { search: 'Engineer', status: 'new' });
    expect(mine.data.map(j => j.id)).toContain(orgs.a.jobId);
    // B's seeded job is 'Engineer'/'new' too, so an unscoped query returns it
    // here — the filters are not what keeps it out.
    expect(mine.data.map(j => j.id)).not.toContain(orgs.b.jobId);
  });

  it('getJobById refuses another org’s job', async () => {
    expect(await db.getJobById(orgs.a.ctx, orgs.a.jobId)).not.toBeNull();
    expect(await db.getJobById(orgs.a.ctx, orgs.b.jobId)).toBeNull();
  });

  it('getJobWithIntel does not surface another org’s job at the same company', async () => {
    const intel = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
    expect(intel).not.toBeNull();
    const relatedIds = intel!.related!.company_jobs.map(j => j.id);
    // Positive control: A's *own* second posting at 'Shared Co' is the whole
    // point of the related-jobs panel and must still be there.
    expect(relatedIds).toContain(aSecondJobId);
    expect(intel!.related!.company_jobs.every(j => j.org_id === orgs.a.orgId)).toBe(true);
    expect(relatedIds).not.toContain(orgs.b.jobId);
  });

  it('getJobWithIntel does not surface another org’s submission at the same company', async () => {
    // B's seeded submission hangs off B's 'Shared Co' job. Unscoped, the
    // related-jobs list leaks B's job and the submission lookup then leaks
    // who B put forward for it.
    const intel = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
    const subIds = intel!.related!.company_submissions.map(s => s.id);
    expect(subIds).not.toContain(orgs.b.submissionId);
    expect(intel!.related!.company_submissions.every(s => s.org_id === orgs.a.orgId)).toBe(true);
  });

  it('getJobWithIntel does not link to another org’s lead', async () => {
    // Phase 1 — positive control. Both orgs have a lead at 'Shared Co', and
    // the scoped lookup must resolve to A's.
    await sql(`UPDATE leads SET company_name = 'Shared Co' WHERE org_id IN ($1, $2)`,
      [orgs.a.orgId, orgs.b.orgId]);
    const withMine = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
    expect(withMine!.related!.lead_id).toBe(orgs.a.leadId);

    // Phase 2 — the attack. Only B now has a lead at 'Shared Co'. Scoped, the
    // panel must show no linked lead at all; unscoped it hands A org B's lead
    // id. Phase 1 alone cannot catch that: an unscoped `.limit(1)` happens to
    // return A's row there by insertion order.
    await sql(`UPDATE leads SET company_name = 'Alpha Co' WHERE org_id = $1`, [orgs.a.orgId]);
    const withoutMine = await db.getJobWithIntel(orgs.a.ctx, orgs.a.jobId);
    expect(withoutMine!.related!.lead_id).toBeUndefined();

    await sql(`UPDATE leads SET company_name = 'Shared Co' WHERE org_id = $1`, [orgs.a.orgId]);
  });

  it('getJobWithIntel refuses another org’s job outright', async () => {
    expect(await db.getJobWithIntel(orgs.a.ctx, orgs.b.jobId)).toBeNull();
  });
});

describe('writes', () => {
  it('updateJob cannot touch another org’s job', async () => {
    const mine = await db.updateJob(orgs.a.ctx, orgs.a.jobId, { status: 'reviewed' });
    expect(mine.status).toBe('reviewed');

    await expect(db.updateJob(orgs.a.ctx, orgs.b.jobId, { status: 'archived' })).rejects.toThrow();
    const { rows } = await sql(`SELECT status FROM jobs WHERE id = $1`, [orgs.b.jobId]);
    expect(rows[0].status).toBe('new');

    await db.updateJob(orgs.a.ctx, orgs.a.jobId, { status: 'new' });
  });

  it('updateJob will not move a job into another org', async () => {
    // A real field travels with the org_id so the update has a body at all:
    // stripped down to nothing, PostgREST rejects the request and this would
    // pass for the wrong reason.
    const moved = await db.updateJob(
      orgs.a.ctx, orgs.a.jobId, { status: 'reviewed', org_id: orgs.b.orgId } as never,
    );
    expect(moved.org_id).toBe(orgs.a.orgId);
    expect(moved.status).toBe('reviewed');

    await db.updateJob(orgs.a.ctx, orgs.a.jobId, { status: 'new' });
  });

  it('createJobSignal stamps the caller’s org and is rejected for another org’s job', async () => {
    await expect(
      db.createJobSignal(orgs.a.ctx, { job_id: orgs.a.jobId, summary: 'mine' }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    // On the constraint NAME: a NOT NULL or permission error would also throw
    // and would leave this test claiming the composite FK caught something it
    // did not.
    await expect(
      db.createJobSignal(orgs.a.ctx, { job_id: orgs.b.jobId, summary: 'theirs' }),
    ).rejects.toThrow(/job_signals_job_org_fkey|foreign key/i);
  });

  it('createJobSubmission on another org’s job is rejected', async () => {
    await expect(
      db.createJobSubmission(orgs.a.ctx, { job_id: orgs.a.jobId, profile_label: 'Mine' }),
    ).resolves.toMatchObject({ org_id: orgs.a.orgId });

    await expect(
      db.createJobSubmission(orgs.a.ctx, { job_id: orgs.b.jobId, profile_label: 'X' }),
    ).rejects.toThrow(/job_submissions_job_org_fkey|foreign key/i);

    const { rows } = await sql(
      `SELECT count(*)::int AS n FROM job_submissions WHERE job_id = $1 AND org_id = $2`,
      [orgs.b.jobId, orgs.a.orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('updateJobSubmission cannot touch another org’s submission', async () => {
    // The id-addressed write: nothing about the payload names an org, so the
    // `.eq('org_id', ...)` scope is the only thing between A and B's row.
    const mine = await db.updateJobSubmission(orgs.a.ctx, orgs.a.submissionId, { status: 'screening' });
    expect(mine.status).toBe('screening');

    await expect(
      db.updateJobSubmission(orgs.a.ctx, orgs.b.submissionId, { status: 'rejected' }),
    ).rejects.toThrow();

    const { rows } = await sql(`SELECT status FROM job_submissions WHERE id = $1`, [orgs.b.submissionId]);
    expect(rows[0].status).toBe('submitted');
  });

  it('deleteJobSubmission cannot delete another org’s submission', async () => {
    // delete() reports no error for zero matched rows, so this is asserted on
    // the rows themselves: B's survives, A's own really does go.
    await db.deleteJobSubmission(orgs.a.ctx, orgs.b.submissionId);
    const theirs = await sql(`SELECT count(*)::int AS n FROM job_submissions WHERE id = $1`, [orgs.b.submissionId]);
    expect(theirs.rows[0].n).toBe(1);

    await db.deleteJobSubmission(orgs.a.ctx, orgs.a.submissionId);
    const mine = await sql(`SELECT count(*)::int AS n FROM job_submissions WHERE id = $1`, [orgs.a.submissionId]);
    expect(mine.rows[0].n).toBe(0);
  });

  it('convertJobToLead produces a lead in the caller’s org', async () => {
    const job = await db.getJobById(orgs.a.ctx, aSecondJobId);
    const lead = await db.convertJobToLead(orgs.a.ctx, job!);
    expect(lead.org_id).toBe(orgs.a.orgId);

    const { rows } = await sql(`SELECT org_id, converted_lead_id FROM jobs WHERE id = $1`, [aSecondJobId]);
    expect(rows[0].org_id).toBe(orgs.a.orgId);
    expect(rows[0].converted_lead_id).toBe(lead.id);
  });
});
