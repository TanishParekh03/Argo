require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: false }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });


app.get("/profiles", async (req, res) => {
  const {
    float_id,
    time_gte,
    time_lte,
    bbox,         
    near,          
    limit = 5000,
    offset = 0
  } = req.query;

  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };

  if (float_id) add("float_id = ?", float_id);
  if (time_gte) add("profile_time >= ?", time_gte);
  if (time_lte) add("profile_time <= ?", time_lte);

  if (bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
    params.push(minLat, maxLat, minLon, maxLon);
    where.push(`latitude BETWEEN $${params.length-3} AND $${params.length-2} AND longitude BETWEEN $${params.length-1} AND $${params.length}`);
  }
  if (near) {
    const [lon, lat, radiusKm] = near.split(",").map(Number);
    params.push(lat, lon, lat, radiusKm);
    where.push(`(6371.0 * acos( cos(radians($${params.length-3})) * cos(radians(latitude)) * cos(radians(longitude) - radians($${params.length-2})) + sin(radians($${params.length-3})) * sin(radians(latitude)) )) <= $${params.length}`);
  }

  params.push(Number(limit), Number(offset));

  const sql = `
    SELECT id, float_id, profile_time, latitude, longitude, source_file
    FROM profiles
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY profile_time DESC
    LIMIT $${params.length-1} OFFSET $${params.length}
  `;

  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows.map(r => ({
      id: r.id,
      float_id: r.float_id,
      profile_time: r.profile_time,
      location: { type: "Point", coordinates: [r.longitude, r.latitude] },
      source_file: r.source_file
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/profiles/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const prof = await pool.query(
      `SELECT id, float_id, profile_time, latitude, longitude, source_file
       FROM profiles WHERE id = $1`, [id]);
    if (!prof.rowCount) return res.status(404).json({ error: "not found" });

    const meas = await pool.query(
      `SELECT depth, temperature, salinity, extras
       FROM measurements WHERE profile_id = $1
       ORDER BY depth`, [id]);
    const merged = meas.rows.map(r => {
      let extras = r.extras;
      if (typeof extras === 'string') {
        try { extras = JSON.parse(extras); } catch { extras = {}; }
      }
      return Object.assign({}, extras || {}, { depth: r.depth, temperature: r.temperature, salinity: r.salinity });
    });

    const p = prof.rows[0];
    const base = {
      id: p.id,
      float_id: p.float_id,
      profile_time: p.profile_time,
      source_file: p.source_file,
      measurements: merged,
      location: { type: "Point", coordinates: [p.longitude, p.latitude] }
    };
    res.json(base);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));
