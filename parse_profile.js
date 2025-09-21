const fs = require("fs");
const { NetCDFReader } = require("netcdfjs");

const JULD_EPOCH_MS = Date.UTC(1950, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

function toISOFromJuld(juld) {
  if (juld == null || !isFinite(juld)) return null;
  const d = new Date(JULD_EPOCH_MS + juld * DAY_MS);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toISOFromUnits(value, units) {
  if (value == null || !isFinite(value) || !units) return null;
  const m = String(units).toLowerCase().match(/(seconds|days|hours) since\s*(\d{4}-\d{2}-\d{2})([ t]?(\d{2}:\d{2}:\d{2})z?)?/);
  if (!m) return null;
  const unit = m[1];
  const dateStr = m[2] + (m[4] ? 'T' + m[4] + 'Z' : 'T00:00:00Z');
  const base = Date.parse(dateStr);
  if (isNaN(base)) return null;
  let ms = 0;
  if (unit === 'seconds') ms = value * 1000;
  else if (unit === 'hours') ms = value * 3600 * 1000;
  else if (unit === 'days') ms = value * DAY_MS;
  const d = new Date(base + ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function getVar(reader, name) {
  const v = reader.variables.find(v => v.name === name);
  if (!v) return null;
  return {
    var: v,
    data: reader.getDataVariable(name),
    attrs: Object.fromEntries(v.attributes.map(a => [a.name, a.value]))
  };
}

function getVarCI(reader, names) {
  const set = new Set(names.map(n => String(n).toLowerCase()));
  for (const v of reader.variables) {
    if (set.has(String(v.name).toLowerCase())) {
      return {
        var: v,
        data: reader.getDataVariable(v.name),
        attrs: Object.fromEntries(v.attributes.map(a => [a.name, a.value]))
      };
    }
  }
  return null;
}

function getVarByStandardName(reader, stdName) {
  for (const v of reader.variables) {
    const attr = v.attributes.find(a => a.name === 'standard_name');
    if (attr && String(attr.value).toLowerCase() === String(stdName).toLowerCase()) {
      return {
        var: v,
        data: reader.getDataVariable(v.name),
        attrs: Object.fromEntries(v.attributes.map(a => [a.name, a.value]))
      };
    }
  }
  return null;
}

function cleanValue(v, fill) {
  if (v == null) return null;
  if (fill != null && v === fill) return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

function sanitizeStr(s) {
  if (s == null) return null;
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

async function parseArgoProfile(filePath) {
  const ab = toArrayBuffer(fs.readFileSync(filePath));
  const reader = new NetCDFReader(ab);

  
  const latV = getVarCI(reader, ["LATITUDE","latitude","Lat"]) || getVarByStandardName(reader, "latitude");
  const lonV = getVarCI(reader, ["LONGITUDE","longitude","Lon"]) || getVarByStandardName(reader, "longitude");
  const juldV = getVarCI(reader, ["JULD"]) || getVarByStandardName(reader, "time");
  const timeV = getVarCI(reader, ["time"]) || getVarByStandardName(reader, "time");

  if (!latV || !lonV) {
    throw new Error("Missing LATITUDE/LONGITUDE variables");
  }

  const floatIdV = getVar(reader, "PLATFORM_NUMBER") || getVar(reader, "PLATFORM_NUMBER:STRING") || getVar(reader, "WMO_ID") || null;

  const presV = getVarCI(reader, ["PRES","pressure","Pressure"]) || getVarCI(reader, ["Depth","depth"]);
  const tempV = getVarCI(reader, ["TEMP","temperature","Temperature"]);
  const psalV = getVarCI(reader, ["PSAL","salinity","Salinity"]);

  const presFill = presV?.attrs?._FillValue ?? presV?.attrs?.missing_value ?? null;
  const tempFill = tempV?.attrs?._FillValue ?? tempV?.attrs?.missing_value ?? null;
  const psalFill = psalV?.attrs?._FillValue ?? psalV?.attrs?.missing_value ?? null;

  const pickFirstFinite = (arr) => {
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (Number.isFinite(v)) return v;
      }
      return null;
    }
    return Number.isFinite(arr) ? arr : null;
  };

  const latitude = pickFirstFinite(latV.data);
  const longitude = pickFirstFinite(lonV.data);

  let profile_time = null;
  if (juldV) {
    const juld = pickFirstFinite(juldV.data);
    profile_time = toISOFromJuld(juld);
  } else if (timeV) {
    const tval = pickFirstFinite(timeV.data);
    const units = timeV.attrs?.units || timeV.attrs?.Units || null;
    profile_time = toISOFromUnits(tval, units) || null;
  }

  let float_id = null;
  if (floatIdV?.data != null) {
    if (typeof floatIdV.data === "string") {
      float_id = sanitizeStr(floatIdV.data);
    } else if (Array.isArray(floatIdV.data)) {
      float_id = sanitizeStr(String.fromCharCode(...floatIdV.data));
    } else {
      float_id = sanitizeStr(String(floatIdV.data));
    }
  }

  const measurements = [];
  const n = Math.max(presV?.data?.length || 0, tempV?.data?.length || 0, psalV?.data?.length || 0);


  const excludeNames = new Set([
    "LATITUDE","LONGITUDE","JULD","TIME","time","latitude","longitude","Lat","Lon",
    "CYCLE_NUMBER","N_PROF","N_LEVELS",
    "TEMP","PSAL","PRES","temperature","salinity","pressure","Temperature","Salinity","Pressure","Depth","depth",
    "TEMP_ADJUSTED","PSAL_ADJUSTED","PRES_ADJUSTED"
  ]);
  const isQc = (name) => name.endsWith("_QC") || name.includes("_QC_") || name.endsWith("_ADJUSTED_ERROR") || name.endsWith("_ERROR");

  const extrasVars = [];
  const isArrayLike = (x) => (Array.isArray(x) || ArrayBuffer.isView(x)) && typeof x.length === 'number';
  for (const v of reader.variables) {
    if (!v || !v.name || excludeNames.has(v.name) || isQc(v.name)) continue;
    let data;
    try { data = reader.getDataVariable(v.name); } catch { continue; }
    if (!isArrayLike(data)) continue; 
    if (data.length !== n || n === 0) continue; 

    const first = data[0];
    if (typeof first !== 'number' && !data.some && typeof first !== 'number') continue;
    extrasVars.push({ name: v.name, data, attrs: Object.fromEntries(v.attributes.map(a => [a.name, a.value])) });
  }


  for (let i = 0; i < n; i++) {
    const pressure = presV ? cleanValue(presV.data[i], presFill) : null;
    const temperature = tempV ? cleanValue(tempV.data[i], tempFill) : null;
    const salinity = psalV ? cleanValue(psalV.data[i], psalFill) : null;

    const extras = {};
    for (const v of extrasVars) {
      const fill = v.attrs?._FillValue ?? v.attrs?.missing_value ?? null;
      const val = cleanValue(v.data[i], fill);
      if (val != null) {
        extras[v.name.toLowerCase()] = val;
      }
    }

    if (pressure != null || temperature != null || salinity != null || Object.keys(extras).length) {
      measurements.push({ pressure, temperature, salinity, extras });
    }
  }

  return {
    float_id: float_id || null,
    profile_time,
    latitude,
    longitude,
    measurements,
    source_file: filePath
  };
}

module.exports = { parseArgoProfile };
