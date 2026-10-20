/* eslint-disable @typescript-eslint/no-require-imports -- This CommonJS script runs inside the previously deployed container. */
// Run inside the existing server container after backup, before switching images.
const { Pool } = require('/app/node_modules/pg');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
(async () => {
  if (process.env.PAYMENT_PROVIDER !== 'nexi' || process.env.NEXI_ENV !== 'test') throw new Error('TEST_ONLY');
  const root = process.argv[2];
  const config = JSON.parse(readFileSync(path.join(root, 'fiscal-settings.json'), 'utf8'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('localvista-test-deploy'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS localvista_deploy');
    await db.query('REVOKE ALL ON SCHEMA localvista_deploy FROM PUBLIC, anon, authenticated');
    await db.query('CREATE TABLE IF NOT EXISTS localvista_deploy.migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of ['014_fiscal_jobs.sql','015_fiscal_pdf_storage.sql','016_fiscal_email_jobs.sql','017_refunds_fiscal_cancellations.sql','018_client_rescheduling.sql','019_salon_checkout_quotes.sql','020_customer_commerce.sql','021_grouped_checkout.sql','022_widget_service_bundles.sql']) {
      const raw = readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
      const checksum = createHash('sha256').update(raw).digest('hex');
      const prior = await db.query('SELECT checksum FROM localvista_deploy.migrations WHERE version=$1',[file]);
      if (prior.rows.length) {
        if (prior.rows[0].checksum !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
        console.log('Already applied: '+file); continue;
      }
      await db.query(raw.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
      await db.query('INSERT INTO localvista_deploy.migrations(version,checksum) VALUES($1,$2)',[file,checksum]);
      console.log('Prepared: '+file);
    }
    const salons = await db.query('SELECT id FROM public.salons WHERE id=$1',[config.salonId]);
    if (salons.rows.length !== 1) throw new Error('SALON_MISMATCH');
    await db.query(`INSERT INTO public.fiscal_configs(salon_id,provider,mode,enabled,organization_id,taxpayer_id,location_id,system_id)
      VALUES($1,'fiskaly','test',true,$2,$3,$4,$5)
      ON CONFLICT(salon_id,provider) DO UPDATE SET mode='test',enabled=true,organization_id=EXCLUDED.organization_id,
      taxpayer_id=EXCLUDED.taxpayer_id,location_id=EXCLUDED.location_id,system_id=EXCLUDED.system_id`,
      [config.salonId,config.organizationId,config.taxpayerId,config.locationId,config.env.FISKALY_SYSTEM_ID]);
    await db.query("NOTIFY pgrst, 'reload schema'");
    await db.query('COMMIT');
    console.log('Fiscal TEST migrations and salon configuration committed.');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
  finally { db.release(); await pool.end(); }
})().catch(e=>{console.error('Migration failed: '+(e.code || e.message));process.exitCode=1});
