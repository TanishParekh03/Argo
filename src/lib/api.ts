export interface ProfileSummary {
  id: number
  float_id: number
  profile_time: string
  location: { type: 'Point', coordinates: [number, number] } // [lon, lat]
  source_file: string
  // Optional computed client-side field for heatmap (not from API):
  surfaceTemp?: number | null
}

export interface Measurement {
  depth: number | null
  temperature?: number | null
  salinity?: number | null
  // extras may include nitrate, oxygen, etc. They are flattened by backend already where possible
  [k: string]: any
}

export interface ProfileDetail {
  id: number
  float_id: number
  profile_time: string
  source_file: string
  location: { type: 'Point', coordinates: [number, number] }
  measurements: Measurement[]
}

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api'

export async function fetchProfiles(bbox?: { minLon: number, minLat: number, maxLon: number, maxLat: number }): Promise<ProfileSummary[]> {
  const params = new URLSearchParams()
  if (bbox) params.set('bbox', `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`)
  // Limit default: backend uses 100; allow user default
  const url = `${base}/profiles${params.toString() ? `?${params.toString()}` : ''}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Failed to fetch profiles: ${r.status}`)
  const data = await r.json() as ProfileSummary[]
  // Compute a placeholder surfaceTemp as undefined for now; can be populated when user selects a profile
  return data
}

export async function fetchProfileById(id: number): Promise<ProfileDetail> {
  const r = await fetch(`${base}/profiles/${id}`)
  if (!r.ok) throw new Error(`Failed to fetch profile ${id}: ${r.status}`)
  const data = await r.json() as ProfileDetail
  return data
}
