import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { hexbin as hexbinFactory } from 'd3-hexbin'
import L from 'leaflet'
import { type ProfileSummary } from '@/lib/api'

// Utility to derive a "surface" temperature from each profile (uses shallowest measurement if available later)
function surfaceTemperature(p: ProfileSummary & { surfaceTemp?: number }): number | null {
  return p.surfaceTemp ?? null
}

export default function MapCanvas({
  profiles,
  onBboxQuery,
  onProfileClick,
}: {
  profiles: ProfileSummary[]
  onBboxQuery: (bbox: { minLon: number, minLat: number, maxLon: number, maxLat: number }) => void
  onProfileClick: (id: number) => void
}) {
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<SVGSVGElement | null>(null)
  const gPointsRef = useRef<SVGGElement | null>(null)
  const gHexRef = useRef<SVGGElement | null>(null)
  const profilesRef = useRef<ProfileSummary[]>([])
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (mapRef.current) return

    const map = L.map('map', {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
      boxZoom: true,
      attributionControl: true,
      zoomControl: true,
    })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 8,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)

    // Create D3 SVG overlay in Leaflet overlay pane
    const overlay = d3.select(map.getPanes().overlayPane)
      .append('svg')
      .attr('class', 'd3-overlay')
      .style('position', 'absolute')
      .style('top', 0)
      .style('left', 0)
      .node() as SVGSVGElement

    overlayRef.current = overlay

    const g = d3.select(overlay).append('g').attr('class', 'leaflet-zoom-hide')
    gHexRef.current = g.append('g').attr('class', 'hex-layer').node() as SVGGElement
    gPointsRef.current = g.append('g').attr('class', 'points-layer').node() as SVGGElement

    // Tooltip over map container
    const tip = d3.select(map.getContainer())
      .append('div')
      .attr('class', 'map-tooltip')
      .style('opacity', 0)
      .node() as HTMLDivElement
    tooltipRef.current = tip

    const update = () => {
      if (!overlayRef.current || !gPointsRef.current || !gHexRef.current) return
      const bounds = map.getBounds()
      const topLeft = map.latLngToLayerPoint(bounds.getNorthWest())
      const bottomRight = map.latLngToLayerPoint(bounds.getSouthEast())

      const svg = d3.select(overlayRef.current)
      svg
        .attr('width', bottomRight.x - topLeft.x)
        .attr('height', bottomRight.y - topLeft.y)
        .style('transform', `translate(${topLeft.x}px, ${topLeft.y}px)`) // position over map viewport

      const project = (lat: number, lon: number) => {
        // Normalize longitude to [-180, 180] to ensure proper world wrap behavior in overlay
        let nlon = lon
        if (nlon > 180) nlon = nlon - 360
        if (nlon < -180) nlon = nlon + 360
        const pt = map.latLngToLayerPoint([lat, nlon])
        return [pt.x - topLeft.x, pt.y - topLeft.y] as [number, number]
      }

      // World-anchored projection for stable hexbins
      const zoom = map.getZoom()
      const nwLatLng = bounds.getNorthWest()
      const seLatLng = bounds.getSouthEast()
      const nwWorld = map.project(nwLatLng, zoom)
      const seWorld = map.project(seLatLng, zoom)
      const projectWorld = (lat: number, lon: number) => {
        let nlon = lon
        if (nlon > 180) nlon = nlon - 360
        if (nlon < -180) nlon = nlon + 360
        return map.project([lat, nlon], zoom)
      }

      // Render temperature hexbin heatmap from profiles that have surface temp
      const current = profilesRef.current
      const pts = current
        .map(p => {
          const [lon, lat] = p.location.coordinates
          const w = projectWorld(lat, lon)
          return { wx: w.x, wy: w.y, st: surfaceTemperature(p as any), id: p.id }
        })
        .filter(d => d.st != null)

      const gHex = d3.select(gHexRef.current)

      // radius grows with zoom-in, shrinks with zoom-out
      const baseRadius = 6 // px at zoom 3
      const radius = Math.max(5, Math.min(40, baseRadius * Math.pow(2, zoom - 3)))

      const hexbin = hexbinFactory()
        .x((d: any) => d.wx)
        .y((d: any) => d.wy)
        .extent([[nwWorld.x, nwWorld.y], [seWorld.x, seWorld.y]])
        .radius(radius)

      const bins = hexbin(pts as any)
      // attach average temperature to each bin
      bins.forEach((bin: any) => {
        const values = bin.map((d: any) => d.st as number)
        const avg = d3.mean(values as number[])
        ;(bin as any).avg = avg ?? null
      })

      const temps = bins.map((b: any) => (b as any).avg).filter((v: number | null) => v != null) as number[]
      const domain = d3.extent(temps) as [number, number] | [undefined, undefined]
      const color = d3.scaleSequential(d3.interpolateTurbo)
        .domain(domain[0] != null && domain[1] != null ? (domain as [number, number]) : [0, 1])

      const hexSel = gHex.selectAll('path.hex').data(bins as any, (d: any) => `${d.x},${d.y}`)
      const enteredHex = hexSel.enter()
        .append('path')
        .attr('class', 'hex')
        .style('cursor', 'pointer')
        .on('click', (ev: any, d: any) => {
          if (!d || !d.length) return
          let best: any = d[0]
          let bestDist = Infinity
          for (const pt of d) {
            const dx = pt.wx - d.x
            const dy = pt.wy - d.y
            const dist = dx*dx + dy*dy
            if (dist < bestDist) { bestDist = dist; best = pt }
          }
          if (best?.id != null) onProfileClick(best.id)
        }) as any

      const merged = (enteredHex as any).merge(hexSel as any)
      merged
        .attr('d', (d: any) => hexbin.hexagon())
        .attr('transform', (d: any) => `translate(${d.x - nwWorld.x},${d.y - nwWorld.y})`)
        .attr('fill', (d: any) => (d.avg != null ? String(color(d.avg)) : 'transparent'))
        .attr('fill-opacity', 0.5)
        .attr('stroke', 'none')
        .on('mousemove', (ev: MouseEvent, d: any) => {
          if (!tooltipRef.current) return
          const rect = map.getContainer().getBoundingClientRect()
          const mx = ev.clientX - rect.left
          const my = ev.clientY - rect.top
          const c = (d as any).length || 0
          const a = (d as any).avg
          const html = a != null
            ? `Avg temp: <b>${d3.format('.2f')(a)} °C</b><br/>Count: ${c}<br/><i>Click to open nearest profile</i>`
            : `No temperature<br/>Count: ${c}<br/><i>Click to open nearest profile</i>`
          d3.select(tooltipRef.current)
            .style('opacity', 1)
            .style('left', `${mx + 12}px`)
            .style('top', `${my + 12}px`)
            .html(html)
        })
        .on('mouseleave', () => {
          if (!tooltipRef.current) return
          d3.select(tooltipRef.current).style('opacity', 0)
        })
      hexSel.exit().remove()

      // Render float points
      const gPoints = d3.select(gPointsRef.current)
      const pointSel = gPoints.selectAll('circle.float-point').data(current as any, (d: any) => d.id)

      const entered = pointSel.enter()
        .append('circle')
        .attr('class', 'float-point')
        .attr('r', 4)
        .attr('fill', '#0ea5e9')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .on('click', (_: any, d: any) => onProfileClick(d.id))

      // add simple title tooltip
      entered.append('title')
        .text((d: any) => `Float ${d.float_id ?? ''}\n${new Date(d.profile_time).toLocaleString()}`)

      // merge update + enter for positioning
      const allCircles = (entered as any).merge(pointSel as any) as d3.Selection<SVGCircleElement, any, any, any>

      const updatePoint = (sel: d3.Selection<SVGCircleElement, any, any, any>) => {
        sel
          .attr('cx', (d: any) => project(d.location.coordinates[1], d.location.coordinates[0])[0])
          .attr('cy', (d: any) => project(d.location.coordinates[1], d.location.coordinates[0])[1])
      }

      updatePoint(allCircles)
      ;(pointSel.exit() as any).remove()
    }

    map.on('moveend viewreset zoomend', update)

    // Handle box zoom to query bbox
    map.on('boxzoomend', (e: any) => {
      const b: L.LatLngBounds = e.boxZoomBounds || e.boxZoomBounds !== undefined ? e.boxZoomBounds : e.boxZoomBounds
      const bounds = b || map.getBounds()
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      onBboxQuery({
        minLon: sw.lng,
        minLat: sw.lat,
        maxLon: ne.lng,
        maxLat: ne.lat,
      })
    })

    // Initial draw
    update()

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Redraw overlay on profiles change or map change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !overlayRef.current) return
    profilesRef.current = profiles
    // Trigger re-render by emitting a moveend, which calls update using profilesRef
    map.fire('moveend')
  }, [profiles])

  return (
    <div className="map-root">
      <div className="map-toolbar">
        <span>Tip: Hold Shift and drag to draw a box and query that region.</span>
      </div>
      <div id="map" className="map-canvas" />
    </div>
  )
}
