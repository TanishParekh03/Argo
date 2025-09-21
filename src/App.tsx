import React, { useEffect, useState } from 'react'
import MapCanvas from './components/MapCanvas'
import ProfileCharts from './components/ProfileCharts'
import { fetchProfiles, fetchProfileById, type ProfileSummary, type ProfileDetail } from './lib/api'

async function enrichSurfaceTemps(list: ProfileSummary[]): Promise<ProfileSummary[]> {
 
  const MAX = 1000 
  const subset = list.slice(0, MAX)
  const details = await Promise.all(subset.map(p => fetchProfileById(p.id).catch(() => null)))
  const tempById = new Map<number, number | null>()
  details.forEach((d, i) => {
    const id = subset[i].id
    if (!d || !d.measurements?.length) { tempById.set(id, null); return }
    const withDepth = d.measurements.filter(m => m.depth != null && m.temperature != null)
    if (!withDepth.length) { tempById.set(id, null); return }
    const min = withDepth.reduce((a, b) => (a.depth! < b.depth! ? a : b))
    tempById.set(id, (min.temperature as number) ?? null)
  })
  return list.map(p => ({ ...p, surfaceTemp: tempById.has(p.id) ? (tempById.get(p.id) ?? null) : null }))
}

export default function App() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<ProfileDetail | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const raw = await fetchProfiles()
        const enriched = await enrichSurfaceTemps(raw)
        if (!cancelled) setProfiles(enriched)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleBboxQuery = async (bounds: { minLon: number, minLat: number, maxLon: number, maxLat: number }) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchProfiles(bounds)
      const enriched = await enrichSurfaceTemps(data)
      setProfiles(enriched)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleProfileClick = async (id: number) => {
    setSelectedProfile(null)
    try {
      const detail = await fetchProfileById(id)
      setSelectedProfile(detail)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Argo Unified Exploration Hub</h1>
        <div className="status">
          {loading && <span className="badge badge-loading">Loading…</span>}
          {error && <span className="badge badge-error" title={error}>API error</span>}
          {!loading && !error && <span className="badge badge-ok">Connected</span>}
        </div>
      </header>
      <main className="app-main">
        <section className="map-section">
          <MapCanvas
            profiles={profiles}
            onBboxQuery={handleBboxQuery}
            onProfileClick={handleProfileClick}
          />
        </section>
        <aside className="side-section">
          <div className="panels">
            <div className="panel">
              <h2>Data Profiles</h2>
              <ProfileCharts profile={selectedProfile} />
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
