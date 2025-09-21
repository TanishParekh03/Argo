require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { parseArgoProfile } = require("./parse_profile");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});


async function upsertFloat(client, float_id) {
  if (!float_id) return null;
  await client.query(
    `INSERT INTO floats (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [float_id]
  );
  return float_id;
}

async function insertProfile(client, p) {
  const ins = await client.query(
    `INSERT INTO profiles (float_id, profile_time, latitude, longitude, source_file)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_file) DO NOTHING
     RETURNING id`,
    [p.float_id, p.profile_time, p.latitude, p.longitude, p.source_file]
  );
  if (ins.rowCount) return { id: ins.rows[0].id, existed: false };
  const sel = await client.query(`SELECT id FROM profiles WHERE source_file = $1`, [p.source_file]);
  return { id: sel.rows[0].id, existed: true };
}

async function insertMeasurements(client, profile_id, rows) {
  if (!rows.length) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let idx = 1;
    for (const r of chunk) {
      const extras = r.extras ? JSON.stringify(r.extras) : null;
      params.push(profile_id, r.pressure ?? null, r.temperature ?? null, r.salinity ?? null, extras);
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
      idx += 5;
    }
    const sql = `
      INSERT INTO measurements (profile_id, depth, temperature, salinity, extras)
      VALUES ${values.join(",")}
    `;
    await client.query(sql, params);
  }
}

async function ingestFile(ncPath) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await parseArgoProfile(ncPath);
    await upsertFloat(client, profile.float_id);
const { id: profile_id, existed } = await insertProfile(client, profile);
    if (existed) {
      await client.query("ROLLBACK");
      console.log(`Skipped (already ingested) ${path.basename(ncPath)} -> profile_id=${profile_id}`);
      return;
    }
    await insertMeasurements(client, profile_id, profile.measurements);
    await client.query("COMMIT");
    console.log(`Ingested ${path.basename(ncPath)} -> profile_id=${profile_id}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`Failed to ingest ${ncPath}:`, e.message);
  } finally {
    client.release();
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node ingest.js C:\\path\\to\\argo\\profiles");
    process.exit(1);
  }
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".nc"))
    .map(f => path.join(dir, f));

for (const f of files) {
    await ingestFile(f);
  }

  await pool.end();
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
