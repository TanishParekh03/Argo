CREATE TABLE IF NOT EXISTS floats (
  id TEXT PRIMARY KEY,
  meta JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS profiles (
  id BIGSERIAL PRIMARY KEY,
  float_id TEXT REFERENCES floats(id) ON DELETE CASCADE,
  profile_time TIMESTAMPTZ,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  source_file TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT REFERENCES profiles(id) ON DELETE CASCADE,
  depth DOUBLE PRECISION,
  temperature DOUBLE PRECISION,
  salinity DOUBLE PRECISION,
  extras JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS profiles_float_time_idx ON profiles(float_id, profile_time DESC);
CREATE INDEX IF NOT EXISTS profiles_time_idx ON profiles(profile_time);
CREATE INDEX IF NOT EXISTS measurements_profile_id_idx ON measurements(profile_id);


CREATE UNIQUE INDEX IF NOT EXISTS profiles_source_file_uidx ON profiles (source_file);
