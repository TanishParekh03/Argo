import React, { useEffect, useMemo, useRef } from 'react'
import * as d3 from 'd3'
import { type ProfileDetail } from '@/lib/api'

export default function ProfileCharts({ profile }: { profile: ProfileDetail | null }) {
  const ref = useRef<HTMLDivElement | null>(null)

  const vars = useMemo(() => {
    if (!profile) return [] as { key: string, label: string, color: string }[]
    const keys: { key: string, label: string, color: string }[] = []
    // Always show salinity if present
    if (profile.measurements.some(m => m.salinity != null)) keys.push({ key: 'salinity', label: 'Salinity (PSU)', color: '#1d4ed8' })
    // Show temperature profile too (useful)
    if (profile.measurements.some(m => m.temperature != null)) keys.push({ key: 'temperature', label: 'Temperature (°C)', color: '#dc2626' })
    // Optional extras
    const extraKeys = ['nitrate', 'oxygen']
    for (const k of extraKeys) {
      if (profile.measurements.some((m: any) => m[k] != null)) {
        keys.push({ key: k, label: `${k[0].toUpperCase()}${k.slice(1)}`, color: k === 'nitrate' ? '#16a34a' : '#7c3aed' })
      }
    }
    return keys
  }, [profile])

  useEffect(() => {
    if (!ref.current) return
    const container = ref.current
    container.innerHTML = ''

    if (!profile || vars.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'charts-empty'
      empty.textContent = 'Select a float to see vertical profiles.'
      container.appendChild(empty)
      return
    }

    const width = container.clientWidth || 360
    const height = 260
    const margin = { top: 10, right: 20, bottom: 35, left: 50 }

    const depths = profile.measurements.map(m => m.depth).filter((d): d is number => d != null)
    const y = d3.scaleLinear()
      .domain([d3.min(depths) ?? 0, d3.max(depths) ?? 1000])
      .range([margin.top, height - margin.bottom])

    // Invert y-axis so depth increases downward
    const yInv = d3.scaleLinear()
      .domain(y.domain())
      .range([height - margin.bottom, margin.top])

    for (const v of vars) {
      const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('class', 'chart')

      const g = svg.append('g')
      const xValues = profile.measurements.map((m: any) => m[v.key]).filter((d: any) => d != null)
      const x = d3.scaleLinear()
        .domain([d3.min(xValues) ?? 0, d3.max(xValues) ?? 1])
        .nice()
        .range([margin.left, width - margin.right])

      const line = d3.line<any>()
        .x((m: any) => x(m[v.key]))
        .y((m: any) => yInv(m.depth))
        .defined((m: any) => m[v.key] != null && m.depth != null)

      g.append('path')
        .attr('d', line(profile.measurements) || '')
        .attr('fill', 'none')
        .attr('stroke', v.color)
        .attr('stroke-width', 2)

      const ax = d3.axisBottom(x)
      const ay = d3.axisLeft(yInv)
      g.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(ax)
      g.append('g').attr('transform', `translate(${margin.left},0)`).call(ay)

      g.append('text')
        .attr('x', margin.left)
        .attr('y', margin.top + 12)
        .attr('fill', '#475569')
        .attr('font-weight', 600)
        .text(v.label)

      // Simple tooltip on hover
      const tooltip = d3.select(container)
        .append('div')
        .attr('class', 'tooltip')
        .style('opacity', 0)

      const bisect = d3.bisector((d: any) => d.depth).center

      svg.on('mousemove', (event: MouseEvent) => {
        const svgEl = svg.node() as SVGSVGElement
        const svgRect = svgEl.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const mxSvg = event.clientX - svgRect.left
        const mySvg = event.clientY - svgRect.top
        const mxLocal = event.clientX - containerRect.left
        const myLocal = event.clientY - containerRect.top

        const depth = yInv.invert(mySvg)
        const idx = bisect(profile.measurements, depth)
        const m = profile.measurements[Math.max(0, Math.min(profile.measurements.length - 1, idx))]
        const val = (m as any)[v.key]
        if (val == null || m.depth == null) { tooltip.style('opacity', 0); return }
        tooltip
          .style('opacity', 1)
          .style('left', `${mxLocal + 12}px`)
          .style('top', `${myLocal + 12}px`)
          .html(`${v.label}: <b>${d3.format('.3f')(val)}</b><br/>Depth: ${d3.format('.1f')(m.depth)} m`)
      })
      svg.on('mouseleave', () => tooltip.style('opacity', 0))
    }
  }, [profile, vars])

  return (
    <div className="charts-root" ref={ref} />
  )
}
