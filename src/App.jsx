import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import speedHeroBg from './assets/car-hero-2.png'
import thumbnail from './assets/Thumbnail.png'
import './App.css'

// MapLibre GL v6 computes its worker's URL relative to wherever the main
// maplibre-gl.mjs module ends up after bundling (via import.meta.url) — but
// Vite/Rollup bundles that module into a hashed chunk and has no reason to
// know it also needs to emit maplibre-gl-worker.mjs (and the
// maplibre-gl-shared.mjs it imports) alongside it. In production that
// computed URL points at a file that was never emitted, so the worker's
// module fetch just hangs ("pending") and the map never renders. Dev mode
// doesn't have this problem (Vite serves node_modules directly, so
// MapLibre's default computation already resolves correctly) — only
// override it for the production build, where vite.config.js's
// copy-maplibre-worker plugin puts both files at this stable, unbundled
// location in the build output.
if (import.meta.env.PROD) {
  maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`)
}

const MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const VEHICLE_POSITION = [73.79, 18.5089] // Bavdhan, Pune — fixed vehicle position
const CHARGER_POSITION = [73.738, 18.591] // Hinjewadi, Pune — nearest charging station (EV only)
const RANGE_KM = 312 // matches the static range shown in the speed hero panel
const LONG_TRIP_DESTINATION = [73.79, 15.451] // ~340 km south of Bavdhan — demo "long trip" destination
// Satara, Maharashtra — sits directly on the Pune-to-Goa corridor, ~100 km
// south of Bavdhan. Used (not the Hinjewadi charger) when a route's
// distance exceeds RANGE_KM, so the suggested charging stop actually falls
// on the way to a far-south destination like the long-trip demo, instead
// of detouring to a charger that's the wrong direction entirely.
const RANGE_CHARGER_POSITION = [74.0183, 17.6805]
const MEETING_DESTINATION = [73.8967, 18.5362] // Koregaon Park, Pune — demo calendar destination
const MAP_ZOOM = 13
const MAP_PITCH = 45
const ACTIVE_ROUTE_SOURCE_ID = 'active-route'
const ACTIVE_ROUTE_LAYER_ID = 'active-route-layer'

const IDLE_MANEUVER = {
  title: "You're in Bavdhan",
  subtitle: 'No active route',
  distanceValue: '',
  distanceUnit: '',
}

// Matches the static "05:20 PM" shown in TopBar — this cockpit has no live
// clock, so ETA math is anchored to that fixed displayed time.
const APP_CLOCK = { hours: 17, minutes: 20 }

const NAV_ITEMS = [
  { id: 'nav', label: 'Nav', icon: 'nav' },
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'phone', label: 'Phone', icon: 'phone' },
  { id: 'climate', label: 'Climate', icon: 'climate' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

const GEARS = ['P', 'R', 'N', 'D']

const LOAD_LEVELS = [
  { id: 'idle', label: 'Idle' },
  { id: 'cruising', label: 'Cruising' },
  { id: 'congested', label: 'Congested' },
]

// Demo bar simulation triggers — mutually exclusive, so only one of these
// four can ever be the active simulation at a time.
const SIMULATIONS = [
  { id: 'lowBattery', label: 'Low Battery', activeLabel: 'Reset Battery', warning: true },
  { id: 'longTrip', label: 'Long Trip', activeLabel: 'Reset Trip', warning: false },
  { id: 'weather', label: 'Weather', activeLabel: 'Reset Weather', warning: true },
  { id: 'meeting', label: 'Meeting', activeLabel: 'Reset Meeting', warning: false },
]

const SPEED_BY_LOAD = { idle: 0, cruising: 64, congested: 18 }
const GEAR_BY_LOAD = { idle: 'P', cruising: 'D', congested: 'D' }

// Parked draws power (climate, electronics) rather than covering distance,
// so it's shown as a power draw (kW) instead of a distance-based efficiency
// figure, which only makes sense once the vehicle is actually moving.
const EFFICIENCY_BY_LOAD = {
  idle: { label: 'Energy', value: '1.8 kW' },
  cruising: { label: 'Efficiency', value: '5.5 km/kWh' },
  congested: { label: 'Efficiency', value: '8.2 km/kWh' },
}

// Proactive suggestions read the driver's actual advice, not just its
// wording, off loadLevel: idle has time/attention to spare, so the copilot
// frames things around planning ahead; cruising is a light, low-pressure
// heads-up; congested is the highest-cognitive-load context, so the copy is
// briefest and — where the action allows it — offers to just handle it
// rather than asking the driver to weigh options.
const LOW_BATTERY_MESSAGES = {
  idle: 'Battery low. Want me to find the nearest charger?',
  cruising: "Battery's running low. Route to the nearest charger?",
  congested: "Battery low and traffic's draining it fast. I'll route to the nearest charger — go?",
}

const RANGE_MESSAGES = {
  idle: "This trip's beyond your range. Want me to plan a charging stop before you head out?",
  cruising: "You'll fall short before arriving. Add a charging stop en route?",
  congested: "Traffic's cutting your range short of the destination. Reroute via a charger?",
}

const COLD_WEATHER_MESSAGES = {
  idle: "It's 4°C. Want me to pre-warm the cabin so it's ready when you leave?",
  cruising: 'Bit cold out. Want the cabin warmer?',
  congested: "Cold and stuck in traffic — I can warm the cabin to keep you comfortable. Go ahead?",
}

const MEETING_MESSAGES = {
  idle: '6 PM meeting across town. Leave by 5:35 — want the route ready to go?',
  cruising: "6 PM meeting, you're on pace. Set the route?",
  congested: "6 PM meeting's at risk with this traffic. Take the faster route?",
}

// Keyed by suggestion.kind so the active suggestion's displayed text can be
// re-derived from the CURRENT loadLevel at render time, instead of being
// frozen at whatever loadLevel was active the moment it fired.
const SUGGESTION_MESSAGES_BY_KIND = {
  lowBattery: LOW_BATTERY_MESSAGES,
  range: RANGE_MESSAGES,
  coldWeather: COLD_WEATHER_MESSAGES,
  meeting: MEETING_MESSAGES,
}

const KNOWN_CITIES = {
  'new york': [-74.006, 40.7128],
  london: [-0.1276, 51.5072],
  tokyo: [139.6917, 35.6895],
  paris: [2.3522, 48.8566],
  'los angeles': [-118.2437, 34.0522],
  mumbai: [72.8777, 19.076],
  berlin: [13.405, 52.52],
  delhi: [77.209, 28.6139],
}

function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Straight-line (haversine) distance in km between two [lon, lat] points.
function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ~30 km/h average city speed.
function estimateMinutes(distanceKm) {
  return Math.max(1, Math.round((distanceKm / 30) * 60))
}

// APP_CLOCK + minutesFromNow, formatted "H:MM AM/PM".
function formatETA(minutesFromNow) {
  const total = APP_CLOCK.hours * 60 + APP_CLOCK.minutes + minutesFromNow
  const wrapped = ((total % 1440) + 1440) % 1440
  const hours24 = Math.floor(wrapped / 60)
  const mins = wrapped % 60
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(mins).padStart(2, '0')} ${period}`
}

// A route is the single source of truth for the maneuver banner and trip
// meta — both are derived from it so they can never disagree.
function buildRoute(label, subtitle, destination) {
  const distanceKm = haversineKm(VEHICLE_POSITION, destination)
  return { label, subtitle, destination, distanceKm, minutes: estimateMinutes(distanceKm) }
}

function maneuverFromRoute(route) {
  if (!route) return IDLE_MANEUVER
  return {
    title: `Head to ${route.label}`,
    subtitle: route.subtitle,
    distanceValue: route.distanceKm.toFixed(1),
    distanceUnit: 'km',
  }
}

function tripMetaFromRoute(route) {
  if (!route) return null
  return {
    minutesText: `${route.minutes} min`,
    distanceText: `${route.distanceKm.toFixed(1)} km`,
    etaText: formatETA(route.minutes),
  }
}

// Draws (or updates) an accent-gradient route line through an ordered list
// of waypoints (first one should be the vehicle's position), then frames
// all of them with fitBounds. A plain vehicle -> destination hop is just a
// 2-point line; a route with a charging stop passes the charger's
// coordinates as a middle waypoint so the line visibly runs through it.
function drawRouteTo(map, coordinates) {
  if (!map) return

  const routeGeoJSON = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
  }

  const apply = () => {
    const existingSource = map.getSource(ACTIVE_ROUTE_SOURCE_ID)
    if (existingSource) {
      existingSource.setData(routeGeoJSON)
    } else {
      map.addSource(ACTIVE_ROUTE_SOURCE_ID, { type: 'geojson', lineMetrics: true, data: routeGeoJSON })
      map.addLayer({
        id: ACTIVE_ROUTE_LAYER_ID,
        type: 'line',
        source: ACTIVE_ROUTE_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-width': 5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#4F8FFF', 1, '#9B6BFF'],
        },
      })
    }

    const bounds = new maplibregl.LngLatBounds()
    coordinates.forEach((point) => bounds.extend(point))
    const { clientHeight, clientWidth } = map.getContainer()
    const verticalPadding = Math.max(16, Math.min(40, clientHeight / 4))
    const horizontalPadding = Math.max(24, Math.min(70, clientWidth / 6))
    map.fitBounds(bounds, {
      padding: { top: verticalPadding, bottom: verticalPadding, left: horizontalPadding, right: horizontalPadding },
      pitch: MAP_PITCH,
      duration: 1200,
    })
  }

  if (map.isStyleLoaded()) {
    apply()
  } else {
    map.once('load', apply)
  }
}

// Only one route/destination marker is ever active at a time — showing one
// kind clears the other so the map never shows two conflicting routes.
function removeMarker(markerRef) {
  if (markerRef.current) {
    markerRef.current.remove()
    markerRef.current = null
  }
}

// The charger marker is hidden until requested — add it (once) and draw the
// route to it. `chargerMarkerRef` tracks the live Marker instance so it can
// be removed again later by clearActiveRoute.
function showChargerRoute(map, chargerMarkerRef, destinationMarkerRef) {
  if (!map) return
  removeMarker(destinationMarkerRef)
  if (!chargerMarkerRef.current) {
    chargerMarkerRef.current = new maplibregl.Marker({ element: createChargerMarkerEl() })
      .setLngLat(CHARGER_POSITION)
      .addTo(map)
  }
  drawRouteTo(map, [VEHICLE_POSITION, CHARGER_POSITION])
}

// A generic geocoded destination — same pattern as the charger, but the
// marker moves to wherever the copilot resolves the place name to.
function showDestinationRoute(map, destinationMarkerRef, chargerMarkerRef, coords) {
  if (!map) return
  removeMarker(chargerMarkerRef)
  if (destinationMarkerRef.current) {
    destinationMarkerRef.current.setLngLat(coords)
  } else {
    destinationMarkerRef.current = new maplibregl.Marker({ element: createDestinationMarkerEl() })
      .setLngLat(coords)
      .addTo(map)
  }
  drawRouteTo(map, [VEHICLE_POSITION, coords])
}

// Unlike showChargerRoute (which replaces the destination with the charger
// as the new endpoint), this keeps BOTH markers up and draws the route
// through the charger on the way to the original destination — vehicle ->
// charger -> destination — so the charger visibly sits en route instead of
// being a detour to a random direction.
function showChargerStopEnRoute(map, chargerMarkerRef, destinationMarkerRef, chargerCoords, destinationCoords) {
  if (!map) return
  if (chargerMarkerRef.current) {
    chargerMarkerRef.current.setLngLat(chargerCoords)
  } else {
    chargerMarkerRef.current = new maplibregl.Marker({ element: createChargerMarkerEl() })
      .setLngLat(chargerCoords)
      .addTo(map)
  }
  if (destinationMarkerRef.current) {
    destinationMarkerRef.current.setLngLat(destinationCoords)
  } else {
    destinationMarkerRef.current = new maplibregl.Marker({ element: createDestinationMarkerEl() })
      .setLngLat(destinationCoords)
      .addTo(map)
  }
  drawRouteTo(map, [VEHICLE_POSITION, chargerCoords, destinationCoords])
}

// Removes any active marker/route and flies back to the vehicle's fixed
// position — the map's resting/default state.
function clearActiveRoute(map, chargerMarkerRef, destinationMarkerRef) {
  removeMarker(chargerMarkerRef)
  removeMarker(destinationMarkerRef)
  if (!map) return
  if (map.getLayer(ACTIVE_ROUTE_LAYER_ID)) map.removeLayer(ACTIVE_ROUTE_LAYER_ID)
  if (map.getSource(ACTIVE_ROUTE_SOURCE_ID)) map.removeSource(ACTIVE_ROUTE_SOURCE_ID)
  map.flyTo({ center: VEHICLE_POSITION, zoom: MAP_ZOOM, pitch: MAP_PITCH, speed: 1.2, curve: 1.4, essential: true })
}

// "passenger" wins if mentioned; "driver"/"me"/"I'm" mean driver; otherwise
// fall back to whichever zone is currently selected in the Climate card.
function detectClimateZone(text, currentZone) {
  if (/\bpassenger\b/.test(text)) return 'passenger'
  if (/\bdriver\b|\bme\b|\bi'm\b/.test(text)) return 'driver'
  return currentZone
}

// Local keyword/intent parser for the copilot — no external API. Runs the
// real side effects (map, climate, media) via the callbacks in `ctx` and
// returns the confirmation string to display.
async function geocodeAndRoute(placeQuery, ctx) {
  const { mapRef, chargerMarkerRef, destinationMarkerRef, setRoute } = ctx
  const label = titleCase(placeQuery)

  const search = async (query) => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
    )
    return res.json()
  }

  try {
    let results = await search(`${placeQuery}, Pune, India`)
    if (!results.length) results = await search(placeQuery)
    if (!results.length) return "I couldn't find that destination."

    const dest = [parseFloat(results[0].lon), parseFloat(results[0].lat)]
    const subtitle = results[0].display_name?.split(',').slice(0, 2).join(',').trim() ?? label
    showDestinationRoute(mapRef.current, destinationMarkerRef, chargerMarkerRef, dest)

    const route = buildRoute(label, subtitle, dest)
    setRoute(route)
    return `Navigating to ${label} — ${route.distanceKm.toFixed(1)} km away.`
  } catch {
    return "I couldn't find that destination."
  }
}

function runCopilotIntent(rawText, ctx) {
  const text = rawText.toLowerCase().trim()
  const {
    mapRef,
    chargerMarkerRef,
    destinationMarkerRef,
    climateZone,
    setClimateZone,
    setDriverTemp,
    setPassengerTemp,
    setIsPlaying,
    onNextTrack,
    setRoute,
  } = ctx

  const flyToCity = (cityKey, zoom = 12) => {
    const coords = KNOWN_CITIES[cityKey]
    if (!coords || !mapRef.current) return
    mapRef.current.flyTo({ center: coords, zoom, speed: 1.2, curve: 1.4, essential: true })
  }

  const findCity = () => Object.keys(KNOWN_CITIES).find((city) => text.includes(city))

  const adjustZoneTemp = (zone, delta) => {
    const setter = zone === 'driver' ? setDriverTemp : setPassengerTemp
    let next = null
    setter((t) => {
      next = Math.min(28, Math.max(16, t + delta))
      return next
    })
    return next
  }

  const mentionsCharge = /charger|charging|charge|battery/.test(text)
  const mentionsClearRoute = /clear route|clear the route|cancel navigation|cancel route|stop navigation/.test(text)
  const city = findCity()

  if (mentionsClearRoute) {
    clearActiveRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef)
    setRoute(null)
    return 'Route cleared — back to your current location.'
  }

  // Compound / cross-domain: charging + an explicit known city elsewhere.
  if (mentionsCharge && city) {
    flyToCity(city)
    return `Found a charging station near ${titleCase(city)} — rerouting you there.`
  }

  // Any other charging mention routes to the fixed local charger (Hinjewadi)
  // — this is an EV, so charging is the only "refuel" concept. The marker
  // and route only appear now, on request.
  if (mentionsCharge) {
    showChargerRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef)
    const route = buildRoute('Charging Station', 'Hinjewadi, Pune', CHARGER_POSITION)
    setRoute(route)
    return `Rerouting to the nearest charging station in Hinjewadi — ${route.distanceKm.toFixed(1)} km away.`
  }

  if (/somewhere warm|somewhere hot/.test(text)) {
    flyToCity('los angeles', 11)
    return 'Taking you somewhere warm — heading to Los Angeles.'
  }

  if (/cold|chilly|freezing|shivering/.test(text)) {
    const zone = detectClimateZone(text, climateZone)
    const next = adjustZoneTemp(zone, 2)
    setClimateZone(zone)
    return `Warming up the ${zone} side — now ${next}°C.`
  }

  if (/hot|too warm|stuffy|sweating/.test(text)) {
    const zone = detectClimateZone(text, climateZone)
    const next = adjustZoneTemp(zone, -2)
    setClimateZone(zone)
    return `Cooling down the ${zone} side — now ${next}°C.`
  }

  if (city) {
    flyToCity(city)
    return `Navigating to ${titleCase(city)}.`
  }

  // Any other "take me to X" / "navigate to X" phrasing — geocode X via
  // Nominatim (biased toward Pune) rather than relying on a fixed list.
  const navMatch = text.match(/^(?:take me to|navigate to|go to|drive to|head to)\s+(.+)$/)
  if (navMatch) {
    return geocodeAndRoute(navMatch[1].trim(), { mapRef, chargerMarkerRef, destinationMarkerRef, setRoute })
  }

  if (/play music|play/.test(text)) {
    setIsPlaying(true)
    return 'Playing music.'
  }

  if (/pause|stop/.test(text)) {
    setIsPlaying(false)
    return 'Music paused.'
  }

  if (/next|skip/.test(text)) {
    onNextTrack()
    return 'Skipping to the next track.'
  }

  return "I didn't quite catch that. You can ask me to find a charger, navigate somewhere, adjust the temperature, or control music."
}

function NavIcon({ type }) {
  switch (type) {
    case 'nav':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 2L4 7v10l8 5 8-5V7L12 2z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      )
    case 'media':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'phone':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M6.5 3h3l1.5 5.5-2 1.5a11 11 0 005 5l1.5-2L22 14.5V18a2 2 0 01-2 2C10 20 4 14 4 6.5A2 2 0 016 4.5" />
        </svg>
      )
    case 'climate':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 2v20M8 6c0 2.2 1.8 4 4 4s4-1.8 4-4M8 18c0-2.2 1.8-4 4-4s4 1.8 4 4" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      )
  }
}

function Logo() {
  return (
    <div className="nav-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z" />
      </svg>
    </div>
  )
}

function NavRail({ activeId, onSelect }) {
  return (
    <nav className="nav-rail" aria-label="Main navigation">
      <Logo />
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item${activeId === item.id ? ' active' : ''}`}
          aria-label={item.label}
          aria-current={activeId === item.id ? 'page' : undefined}
          onClick={() => onSelect(item.id)}
        >
          <span className="nav-item__icon">
            <NavIcon type={item.icon} />
          </span>
          <span className="nav-item__label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function TopBar({ outsideTemp }) {
  return (
    <header className="top-bar">
      <span className="top-time">05:20 PM</span>
      <button type="button" className="drive-mode-pill">
        <span className="profile-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M4.5 20a7.5 7.5 0 0115 0" />
          </svg>
        </span>
        Comfort
        <svg className="drive-mode-pill__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className="top-right">
        <span className="weather">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M7 18a4 4 0 01-.6-7.96 5 5 0 019.7-1.5A4.5 4.5 0 0117.5 18H7z" />
          </svg>
          {outsideTemp}°C
        </span>
        <button type="button" className="alert-btn" aria-label="Alerts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M12 4L3 20h18L12 4z" strokeLinejoin="round" />
            <path d="M12 10.5v4M12 17.2h.01" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  )
}

function GearSelector({ activeGear, onSelect }) {
  return (
    <div className="gear-selector" role="group" aria-label="Gear selector">
      {GEARS.map((gear) => (
        <button
          key={gear}
          type="button"
          className={`gear-segment${activeGear === gear ? ' active' : ''}`}
          aria-pressed={activeGear === gear}
          onClick={() => onSelect(gear)}
        >
          {gear}
        </button>
      ))}
    </div>
  )
}

function SpeedHeroPanel({ gear, onGearChange, loadLevel, batteryLevel }) {
  const isLowBattery = batteryLevel < 20

  return (
    <section className="speed-hero-panel" aria-label="Speed and vehicle status">
      <img src={speedHeroBg} alt="" className="speed-hero-panel__bg" aria-hidden="true" />
      <div className="speed-hero-panel__content">
        <GearSelector activeGear={gear} onSelect={onGearChange} />
        <div className="speed-readout">
          <span className="speed-value">{SPEED_BY_LOAD[loadLevel]}</span>
          <span className="speed-unit">KM / H</span>
        </div>
        <div className="speed-hero-panel__footer">
          <div className="battery-row">
            <div className="battery-labels">
              <span className="battery-labels__charge">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
                </svg>
                <span className={isLowBattery ? 'status-warning' : 'status-positive'}>{batteryLevel}%</span>
              </span>
              <span className="battery-labels__range">{RANGE_KM} km</span>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill${isLowBattery ? ' progress-fill--warning' : ''}`}
                style={{ width: `${batteryLevel}%` }}
              />
            </div>
          </div>
          <div className="status-chips">
            <span className="chip">
              <span className="chip__label">Drive Mode</span>
              <span className="chip__value">Comfort</span>
            </span>
            <span className="chip">
              <span className="chip__label">ADAS</span>
              <span className="chip__value">Ready</span>
            </span>
            <span className="chip">
              <span className="chip__label">{EFFICIENCY_BY_LOAD[loadLevel].label}</span>
              <span className="chip__value">{EFFICIENCY_BY_LOAD[loadLevel].value}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function createVehicleMarkerEl() {
  const el = document.createElement('div')
  el.className = 'map-marker map-marker--vehicle'
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l7 20-7-4-7 4 7-20z"/></svg>'
  return el
}

function createChargerMarkerEl() {
  const el = document.createElement('div')
  el.className = 'map-marker map-marker--charger'
  el.innerHTML =
    '<span class="map-marker__badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg></span>' +
    '<span class="map-marker__label">Charging Station</span>'
  return el
}

function createDestinationMarkerEl() {
  const el = document.createElement('div')
  el.className = 'map-marker map-marker--destination'
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>'
  return el
}

function NavMap({ mapRef, compact, navFocus }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: VEHICLE_POSITION,
      zoom: MAP_ZOOM,
      pitch: MAP_PITCH,
      attributionControl: false,
    })

    mapRef.current.on('error', (e) => console.error('[maplibre]', e.error))

    // Only the vehicle is shown by default — the charger marker/route
    // appear later, on request, via the copilot.
    new maplibregl.Marker({ element: createVehicleMarkerEl() })
      .setLngLat(VEHICLE_POSITION)
      .addTo(mapRef.current)

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [mapRef])

  // The map area shrinks while the proactive suggestion is showing, and
  // grows to fill the right column in navigation focus mode (to make room
  // without ever squeezing the media/nav controls, or to take over once
  // they're hidden) — resize the canvas to match, once immediately and once
  // after the CSS transition settles.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.resize()
    const timeout = setTimeout(() => map.resize(), 320)
    return () => clearTimeout(timeout)
  }, [compact, navFocus])

  return (
    <div
      id="map-placeholder"
      className={`map-placeholder${compact ? ' map-placeholder--compact' : ''}`}
      ref={containerRef}
    />
  )
}

function NavCard({
  mapRef,
  chargerMarkerRef,
  destinationMarkerRef,
  setRoute,
  maneuver,
  tripMeta,
  compact,
  navFocus,
  onExitNavigation,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('idle') // idle | loading | not-found | error

  const handleSearchKeyDown = async (event) => {
    if (event.key !== 'Enter') return
    const query = searchQuery.trim()
    if (!query || searchStatus === 'loading' || !mapRef.current) return

    setSearchStatus('loading')
    // Same geocodeAndRoute the copilot's "take me to X" uses, so a manually
    // searched destination gets the exact same marker + route line +
    // fitBounds + maneuver banner + trip meta as any other route.
    const result = await geocodeAndRoute(query, { mapRef, chargerMarkerRef, destinationMarkerRef, setRoute })
    setSearchStatus(result === "I couldn't find that destination." ? 'not-found' : 'idle')
  }

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value)
    if (searchStatus !== 'idle') setSearchStatus('idle')
  }

  return (
    <article className="card nav-card">
      <div className="maneuver-pill">
        <div className="maneuver-pill__main">
          <span className="maneuver-pill__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="maneuver-pill__text">
            <span className="maneuver-pill__title">{maneuver.title}</span>
            <span className="maneuver-pill__subtitle">{maneuver.subtitle}</span>
          </span>
        </div>
        <div className="maneuver-pill__right">
          {maneuver.distanceValue && (
            <span className="maneuver-pill__distance">
              <span className="maneuver-pill__distance-value">{maneuver.distanceValue}</span>
              <span className="maneuver-pill__distance-unit">{maneuver.distanceUnit}</span>
            </span>
          )}
          {navFocus && (
            <button
              type="button"
              className="nav-card__exit"
              onClick={onExitNavigation}
              aria-label="Exit navigation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <NavMap mapRef={mapRef} compact={compact} navFocus={navFocus} />
      {tripMeta && (
        <div className="nav-meta">
          <span className="nav-meta__item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tripMeta.minutesText}
          </span>
          <span className="nav-meta__item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tripMeta.distanceText}
          </span>
          <span className="nav-meta__item nav-meta__item--eta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M12 21s7-6.1 7-11.5A7 7 0 105 9.5C5 14.9 12 21 12 21z" />
              <circle cx="12" cy="9.5" r="2.5" />
            </svg>
            ETA <span className="status-positive">{tripMeta.etaText}</span>
          </span>
        </div>
      )}
      <div className={`search-field${searchStatus === 'not-found' || searchStatus === 'error' ? ' search-field--warning' : ''}`}>
        <svg className="search-field__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          className="search-input"
          placeholder="Search destination"
          aria-label="Search destination"
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
        />
        {searchStatus === 'loading' && <span className="search-field__spinner" aria-hidden="true" />}
        {searchStatus === 'not-found' && (
          <span className="search-field__status">No results found</span>
        )}
        {searchStatus === 'error' && (
          <span className="search-field__status">Search failed — try again</span>
        )}
      </div>
    </article>
  )
}

const PLAYLIST = [
  { title: 'Night Drive', artist: 'The Midnight', duration: '3:52' },
  { title: 'Sunset', artist: 'Petit Biscuit', duration: '4:10' },
  { title: 'Midnight City', artist: 'M83', duration: '4:03' },
  { title: 'Nightcall', artist: 'Kavinsky', duration: '4:19' },
]

function parseDurationToSeconds(duration) {
  const [minutes, seconds] = duration.split(':').map(Number)
  return minutes * 60 + seconds
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function MediaCard({ isPlaying, onTogglePlay, trackIndex, onNext, onPrev, compact }) {
  const track = PLAYLIST[trackIndex]
  const durationSeconds = parseDurationToSeconds(track.duration)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Reset the timer whenever the track changes.
  useEffect(() => {
    setElapsedSeconds(0)
  }, [trackIndex])

  // Simple playback clock — only ticks while actually playing.
  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(() => {
      setElapsedSeconds((s) => (s < durationSeconds ? s + 1 : s))
    }, 1000)
    return () => clearInterval(interval)
  }, [isPlaying, durationSeconds, trackIndex])

  const progressPercent = Math.min(100, (elapsedSeconds / durationSeconds) * 100)

  return (
    <article className={`card media-card${compact ? ' media-card--compact' : ''}`}>
      <div className="media-top">
        <div className="media-art-frame">
          <div
            className="media-art"
            role="img"
            aria-label={`${track.title} album cover`}
            style={{ backgroundImage: `url(${thumbnail})` }}
          />
        </div>
        <div className="media-info">
          <h2 className="track-title">{track.title}</h2>
          <p className="track-artist">{track.artist}</p>
        </div>
      </div>
      <div className="media-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="media-times">
          <span>{formatSeconds(elapsedSeconds)}</span>
          <span>{track.duration}</span>
        </div>
      </div>
      <div className="media-controls">
        <button type="button" className="control-btn" aria-label="Previous track" onClick={onPrev}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 6H7V18H5Z" />
            <path d="M19 6L9 12L19 18Z" />
          </svg>
        </button>
        <button
          type="button"
          className="control-btn control-btn--play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={onTogglePlay}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button type="button" className="control-btn" aria-label="Next track" onClick={onNext}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 6L15 12L5 18Z" />
            <path d="M17 6H19V18H17Z" />
          </svg>
        </button>
      </div>
    </article>
  )
}

function ClimateCard({
  activeZone,
  onZoneChange,
  temperature,
  fanLevel,
  onDecrease,
  onIncrease,
}) {
  return (
    <article className="card climate-card">
      <div className="climate-tabs">
        {/* Right-hand-drive layout (India): passenger on the left, driver on the right. */}
        <button
          type="button"
          className={`climate-tab${activeZone === 'passenger' ? ' active' : ''}`}
          aria-pressed={activeZone === 'passenger'}
          onClick={() => onZoneChange('passenger')}
        >
          Passenger
        </button>
        <button
          type="button"
          className={`climate-tab${activeZone === 'driver' ? ' active' : ''}`}
          aria-pressed={activeZone === 'driver'}
          onClick={() => onZoneChange('driver')}
        >
          Driver
        </button>
      </div>
      <div className="climate-temp">
        <button
          type="button"
          className="temp-btn"
          aria-label={`Decrease ${activeZone} temperature`}
          onClick={onDecrease}
        >
          −
        </button>
        <div className="temp-display">
          <span className="temp-value">{temperature}°C</span>
        </div>
        <button
          type="button"
          className="temp-btn temp-btn--increase"
          aria-label={`Increase ${activeZone} temperature`}
          onClick={onIncrease}
        >
          +
        </button>
      </div>
      <div className="fan-speed">
        <span className="fan-speed__label">Fan Speed</span>
        <div className="fan-speed__bar" role="meter" aria-valuenow={fanLevel} aria-valuemin={0} aria-valuemax={5}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={`fan-speed__segment${i < fanLevel ? ' active' : ''}`} />
          ))}
        </div>
      </div>
    </article>
  )
}

function DemoControlBar({
  loadLevel,
  onChange,
  batteryLevel,
  outsideTemp,
  activeSimulation,
  onToggleSimulation,
  voiceMuted,
  onToggleVoiceMuted,
}) {
  const activeLabel = LOAD_LEVELS.find((level) => level.id === loadLevel)?.label ?? loadLevel

  return (
    <div className="demo-bar">
      <span className="demo-bar__caption">Demo Controls</span>

      <div className="demo-bar__group">
        <span className="demo-bar__group-label">Context:</span>
        <div className="demo-bar__segmented" role="group" aria-label="Driving context">
          {LOAD_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              className={`demo-bar__segment${loadLevel === level.id ? ' active' : ''}`}
              aria-pressed={loadLevel === level.id}
              onClick={() => onChange(level.id)}
            >
              {level.label}
            </button>
          ))}
        </div>
      </div>

      <span className="demo-bar__divider" aria-hidden="true" />

      <div className="demo-bar__group">
        <span className="demo-bar__group-label">Simulation:</span>
        {/* Mutually exclusive: exactly one (or none) of these four can be
            active at a time — selecting one deactivates whatever was
            active before it, both visually and in the underlying state. */}
        <div className="demo-bar__segmented" role="group" aria-label="Simulation triggers">
          {SIMULATIONS.map((sim) => {
            const isActive = activeSimulation === sim.id
            return (
              <button
                key={sim.id}
                type="button"
                className={`demo-bar__segment${isActive ? ` active${sim.warning ? ' demo-bar__segment--warning' : ''}` : ''}`}
                aria-pressed={isActive}
                onClick={() => onToggleSimulation(sim.id)}
              >
                {isActive ? sim.activeLabel : sim.label}
              </button>
            )
          })}
        </div>
      </div>

      {speechSynthesisSupported && (
        <>
          <span className="demo-bar__divider" aria-hidden="true" />
          <div className="demo-bar__group">
            <span className="demo-bar__group-label">Voice:</span>
            <button
              type="button"
              className={`demo-bar__segment${!voiceMuted ? ' active' : ''}`}
              aria-pressed={!voiceMuted}
              onClick={onToggleVoiceMuted}
            >
              {voiceMuted ? 'Muted' : 'On'}
            </button>
          </div>
        </>
      )}

      <span className="demo-bar__readout">
        Driving state: {activeLabel} · Battery: {batteryLevel}% · Outside: {outsideTemp}°C
      </span>
    </div>
  )
}

const SpeechRecognitionCtor =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

// Speaks copilot suggestion text aloud (free, no API key — window.speechSynthesis).
// Cancels any speech already in progress first so suggestions never overlap.
// Entirely best-effort: unsupported browsers, blocked autoplay, or any
// runtime error here should never break the UI, so failures are swallowed.
function speakSuggestionText(text) {
  if (!speechSynthesisSupported || !text) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.97
    utterance.pitch = 1
    const englishVoice = window.speechSynthesis.getVoices().find((voice) => /^en/i.test(voice.lang))
    if (englishVoice) utterance.voice = englishVoice
    window.speechSynthesis.speak(utterance)
  } catch {
    // Voice output is a nice-to-have, never let it break the cockpit.
  }
}

function CopilotBar({ onSubmit, response }) {
  const [query, setQuery] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState(null) // { type: 'error', text }
  const recognitionRef = useRef(null)
  const gotFinalResultRef = useRef(false)

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter') return
    const text = query.trim()
    if (!text) return
    onSubmit(text)
    setQuery('')
  }

  const startListening = () => {
    if (!SpeechRecognitionCtor || isListening) return
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    gotFinalResultRef.current = false

    recognition.onstart = () => {
      setIsListening(true)
      setVoiceStatus(null)
      setQuery('')
    }

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      const transcript = result[0].transcript
      setQuery(transcript)
      if (result.isFinal) {
        gotFinalResultRef.current = true
        const text = transcript.trim()
        if (text) onSubmit(text)
      }
    }

    recognition.onerror = (event) => {
      const message =
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access denied — check your browser permissions.'
          : "Didn't catch that — try again or type."
      setVoiceStatus({ type: 'error', text: message })
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
      if (gotFinalResultRef.current) {
        setQuery('')
      } else {
        setQuery('')
        setVoiceStatus((prev) => prev ?? { type: 'error', text: "Didn't catch that — try again or type." })
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  const handleMicClick = () => {
    if (isListening) {
      recognitionRef.current?.stop()
    } else {
      startListening()
    }
  }

  useEffect(() => {
    if (!voiceStatus) return
    const timeout = setTimeout(() => setVoiceStatus(null), 4000)
    return () => clearTimeout(timeout)
  }, [voiceStatus])

  useEffect(() => {
    return () => recognitionRef.current?.abort()
  }, [])

  return (
    <div className="copilot-bar">
      <div className="copilot-bar__row">
        <span className="copilot-bar__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
            <path d="M19 13.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
          </svg>
        </span>
        <input
          type="text"
          className="copilot-bar__input"
          placeholder={isListening ? 'Listening…' : 'Ask your copilot…'}
          aria-label="Ask your copilot"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {SpeechRecognitionCtor && (
          <button
            type="button"
            className={`copilot-bar__mic${isListening ? ' copilot-bar__mic--listening' : ''}`}
            onClick={handleMicClick}
            aria-label={isListening ? 'Stop voice input' : 'Speak a command'}
            aria-pressed={isListening}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
              <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 11z" />
            </svg>
          </button>
        )}
      </div>
      {!isListening && (voiceStatus || response) && (
        <div className="copilot-bar__response-slot">
          {voiceStatus && (
            <span className="copilot-bar__voice-status copilot-bar__voice-status--error">{voiceStatus.text}</span>
          )}
          {!voiceStatus && response && (
            <span key={response.id} className="copilot-bar__response">
              {response.text}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// A card the copilot shows on its own initiative (not in response to a
// command) — visually distinct from CopilotBar's reactive responses via the
// amber "Copilot suggestion" eyebrow and its own action buttons.
function ProactiveSuggestionCard({ suggestion, onPrimary, onDismiss }) {
  if (!suggestion) return null

  return (
    <div className="proactive-suggestion" key={suggestion.id}>
      <div className="proactive-suggestion__text">
        <span className="proactive-suggestion__eyebrow">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
          </svg>
          Copilot
        </span>
        <p className="proactive-suggestion__message">{suggestion.message}</p>
      </div>
      <div className="proactive-suggestion__actions">
        <button
          type="button"
          className="proactive-suggestion__btn proactive-suggestion__btn--primary"
          onClick={onPrimary}
        >
          {suggestion.primaryLabel}
        </button>
        <button
          type="button"
          className="proactive-suggestion__btn proactive-suggestion__btn--secondary"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function App() {
  const [activeNav, setActiveNav] = useState('nav')
  const [gear, setGear] = useState('P')
  const [isPlaying, setIsPlaying] = useState(true)
  const [trackIndex, setTrackIndex] = useState(0)
  const [driverTemp, setDriverTemp] = useState(22)
  const [passengerTemp, setPassengerTemp] = useState(21)
  const [climateZone, setClimateZone] = useState('driver')

  // Tracked driving context for a future copilot feature. Only the speed
  // readout and gear react to it — the rest of the cockpit stays constant.
  const [loadLevel, setLoadLevel] = useState('idle')

  useEffect(() => {
    setGear(GEAR_BY_LOAD[loadLevel])
  }, [loadLevel])

  const mapRef = useRef(null)
  const chargerMarkerRef = useRef(null)
  const destinationMarkerRef = useRef(null)
  const [copilotResponse, setCopilotResponse] = useState(null)
  const [batteryLevel, setBatteryLevel] = useState(78)
  const [outsideTemp, setOutsideTemp] = useState(17)
  // Holds { id, kind, primaryLabel, action } — no fixed message text, so
  // the displayed suggestion (derived below) always reflects the CURRENT
  // loadLevel, not whatever it was the moment the suggestion fired.
  const [proactiveSuggestion, setProactiveSuggestion] = useState(null)
  const activeSuggestion = proactiveSuggestion && {
    ...proactiveSuggestion,
    message: SUGGESTION_MESSAGES_BY_KIND[proactiveSuggestion.kind][loadLevel],
  }
  const [voiceMuted, setVoiceMuted] = useState(false)

  // Chrome populates the voices list asynchronously — warm it on mount so
  // an English voice is actually available by the time the first
  // suggestion fires and tries to pick one.
  useEffect(() => {
    if (!speechSynthesisSupported) return
    window.speechSynthesis.getVoices()
  }, [])

  // Speaks a proactive suggestion aloud exactly once, the moment it fires —
  // keyed off suggestion id, not the live-updating message, so switching
  // Context afterward updates the on-screen wording (see activeSuggestion
  // above) without re-triggering speech and spamming the driver.
  useEffect(() => {
    if (!proactiveSuggestion || voiceMuted) return
    speakSuggestionText(SUGGESTION_MESSAGES_BY_KIND[proactiveSuggestion.kind][loadLevel])
  }, [proactiveSuggestion?.id])

  // Which demo-bar simulation (if any) is currently active — the single
  // source of truth that keeps the four Simulation buttons mutually
  // exclusive. 'lowBattery' | 'longTrip' | 'weather' | 'meeting' | null.
  const [activeSimulation, setActiveSimulation] = useState(null)

  // The single source of truth for "where are we headed": null means idle
  // (no active route). The maneuver banner and trip meta are both derived
  // from it so they can never show conflicting info.
  const [route, setRoute] = useState(null)
  const maneuver = maneuverFromRoute(route)
  const tripMeta = tripMetaFromRoute(route)

  // Navigation focus mode: any active route means the driver just accepted
  // a nav action (accepted a suggestion, searched a destination, or ran a
  // "take me to X" command) or is mid-simulation of one — the route itself
  // is the single source of truth, so this can never drift out of sync with
  // what's actually on the map. Exiting focus mode means clearing the route.
  const navFocus = route !== null

  const handleExitNavigation = () => {
    clearActiveRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef)
    setRoute(null)
    // longTrip/meeting have no state of their own beyond the route/suggestion
    // (unlike lowBattery, which stays "active" via batteryLevel even after
    // its route is cleared) — leaving their demo-bar button highlighted
    // here would be stale, since nothing about them is still running.
    if (activeSimulation === 'longTrip' || activeSimulation === 'meeting') {
      setActiveSimulation(null)
    }
  }

  useEffect(() => {
    if (!copilotResponse) return
    const timeout = setTimeout(() => setCopilotResponse(null), 6000)
    return () => clearTimeout(timeout)
  }, [copilotResponse])

  // Stage B: the copilot speaks first. Low battery on its own (no user
  // command) surfaces a suggestion — skipped if we're already routing to
  // the charger, since the copilot already did the useful thing.
  useEffect(() => {
    if (batteryLevel >= 20) return
    if (route?.label === 'Charging Station') return
    setProactiveSuggestion({
      id: Date.now(),
      kind: 'lowBattery',
      primaryLabel: 'Reroute',
      action: () => {
        showChargerRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef)
        const chargerRoute = buildRoute('Charging Station', 'Hinjewadi, Pune', CHARGER_POSITION)
        setRoute(chargerRoute)
        setCopilotResponse({
          id: Date.now(),
          text: `Rerouting to the nearest charging station in Hinjewadi — ${chargerRoute.distanceKm.toFixed(1)} km away.`,
        })
      },
    })
  }, [batteryLevel])

  // Any time a destination is routed (real geocoding or the "Sim: Long
  // Trip" demo button) whose distance exceeds the remaining range, offer to
  // add a charging stop — skipped if we're already headed to the charger.
  useEffect(() => {
    if (!route) return
    if (route.label === 'Charging Station') return
    if (route.distanceKm <= RANGE_KM) return
    setProactiveSuggestion({
      id: Date.now(),
      kind: 'range',
      primaryLabel: 'Add Charging Stop',
      action: () => {
        // Satara sits on the way south (e.g. toward the Goa long trip),
        // unlike the Hinjewadi charger — keep the original destination's
        // marker up too and route through the stop, not straight to it.
        showChargerStopEnRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef, RANGE_CHARGER_POSITION, route.destination)
        const chargerRoute = buildRoute('Charging Stop', 'Satara, Maharashtra', RANGE_CHARGER_POSITION)
        setRoute(chargerRoute)
        setCopilotResponse({
          id: Date.now(),
          text: `Charging stop added — Satara, ${chargerRoute.distanceKm.toFixed(1)} km, on the way to your destination.`,
        })
      },
    })
  }, [route])

  // Cold weather: offer to pre-warm the cabin — skipped once both zones are
  // already at or above the target temperature.
  useEffect(() => {
    if (outsideTemp >= 10) return
    if (driverTemp >= 22 && passengerTemp >= 22) return
    setProactiveSuggestion({
      id: Date.now(),
      kind: 'coldWeather',
      primaryLabel: 'Warm Up',
      action: () => {
        setDriverTemp(22)
        setPassengerTemp(22)
        setCopilotResponse({ id: Date.now(), text: 'Warming up the cabin to 22°C for both zones.' })
      },
    })
  }, [outsideTemp])

  const handleNextTrack = () => {
    setTrackIndex((i) => (i + 1) % PLAYLIST.length)
    setIsPlaying(true)
  }

  const handlePrevTrack = () => {
    setTrackIndex((i) => (i - 1 + PLAYLIST.length) % PLAYLIST.length)
    setIsPlaying(true)
  }

  const handleCopilotSubmit = (text) => {
    const result = runCopilotIntent(text, {
      mapRef,
      chargerMarkerRef,
      destinationMarkerRef,
      climateZone,
      setClimateZone,
      setDriverTemp,
      setPassengerTemp,
      setIsPlaying,
      onNextTrack: handleNextTrack,
      setRoute,
    })
    if (result instanceof Promise) {
      result.then((replyText) => setCopilotResponse({ id: Date.now(), text: replyText }))
    } else {
      setCopilotResponse({ id: Date.now(), text: result })
    }
  }

  const handleSuggestionPrimary = () => {
    proactiveSuggestion?.action()
    setProactiveSuggestion(null)
  }

  const handleDismissSuggestion = () => setProactiveSuggestion(null)

  const handleSimLongTrip = () => {
    showDestinationRoute(mapRef.current, destinationMarkerRef, chargerMarkerRef, LONG_TRIP_DESTINATION)
    const longRoute = buildRoute('Goa', 'South Goa Coast', LONG_TRIP_DESTINATION)
    setRoute(longRoute)
  }

  const handleSimMeeting = () => {
    setProactiveSuggestion({
      id: Date.now(),
      kind: 'meeting',
      primaryLabel: 'Navigate',
      action: () => {
        showDestinationRoute(mapRef.current, destinationMarkerRef, chargerMarkerRef, MEETING_DESTINATION)
        const meetingRoute = buildRoute('Koregaon Park', 'Meeting location', MEETING_DESTINATION)
        setRoute(meetingRoute)
        setCopilotResponse({
          id: Date.now(),
          text: `Navigating to Koregaon Park — ${meetingRoute.distanceKm.toFixed(1)} km away.`,
        })
      },
    })
  }

  // Reverses whichever simulation was active — restores its underlying
  // state to normal and clears its suggestion — so switching to (or just
  // turning off) another simulation never leaves stale state behind.
  const deactivateSimulation = (sim) => {
    if (sim === 'lowBattery') setBatteryLevel(78)
    if (sim === 'weather') setOutsideTemp(17)
    if (sim === 'longTrip') {
      clearActiveRoute(mapRef.current, chargerMarkerRef, destinationMarkerRef)
      setRoute(null)
    }
    // 'meeting' has no persistent state of its own beyond the suggestion.
    setProactiveSuggestion(null)
  }

  // The demo bar's four Simulation buttons are mutually exclusive: picking
  // one deactivates whatever was active before it, then activates the new
  // one; picking the already-active one just turns it off.
  const handleToggleSimulation = (sim) => {
    if (activeSimulation === sim) {
      deactivateSimulation(sim)
      setActiveSimulation(null)
      return
    }
    if (activeSimulation) deactivateSimulation(activeSimulation)
    if (sim === 'lowBattery') setBatteryLevel(18)
    if (sim === 'weather') setOutsideTemp(4)
    if (sim === 'longTrip') handleSimLongTrip()
    if (sim === 'meeting') handleSimMeeting()
    setActiveSimulation(sim)
  }

  return (
    <div className="app-shell">
      <div className="cockpit">
        <NavRail activeId={activeNav} onSelect={setActiveNav} />
        <div className="main-panel">
          <TopBar outsideTemp={outsideTemp} />
          <div className={`content-area${proactiveSuggestion ? ' content-area--compact' : ''}`}>
            <div className="left-column">
              <SpeedHeroPanel gear={gear} onGearChange={setGear} loadLevel={loadLevel} batteryLevel={batteryLevel} />
            </div>
            <div className={`right-column${navFocus ? ' right-column--focus' : ''}`}>
              <NavCard
                mapRef={mapRef}
                chargerMarkerRef={chargerMarkerRef}
                destinationMarkerRef={destinationMarkerRef}
                setRoute={setRoute}
                maneuver={maneuver}
                tripMeta={tripMeta}
                compact={!!proactiveSuggestion}
                navFocus={navFocus}
                onExitNavigation={handleExitNavigation}
              />
              <div className="bottom-row">
                <MediaCard
                  isPlaying={isPlaying}
                  onTogglePlay={() => setIsPlaying((p) => !p)}
                  trackIndex={trackIndex}
                  onNext={handleNextTrack}
                  onPrev={handlePrevTrack}
                  compact={!!proactiveSuggestion}
                />
                <ClimateCard
                  activeZone={climateZone}
                  onZoneChange={setClimateZone}
                  temperature={climateZone === 'driver' ? driverTemp : passengerTemp}
                  fanLevel={3}
                  onDecrease={() =>
                    climateZone === 'driver'
                      ? setDriverTemp((t) => Math.max(16, t - 1))
                      : setPassengerTemp((t) => Math.max(16, t - 1))
                  }
                  onIncrease={() =>
                    climateZone === 'driver'
                      ? setDriverTemp((t) => Math.min(28, t + 1))
                      : setPassengerTemp((t) => Math.min(28, t + 1))
                  }
                />
              </div>
            </div>
          </div>
          <ProactiveSuggestionCard
            suggestion={activeSuggestion}
            onPrimary={handleSuggestionPrimary}
            onDismiss={handleDismissSuggestion}
          />
          <CopilotBar onSubmit={handleCopilotSubmit} response={copilotResponse} />
        </div>
      </div>
      <DemoControlBar
        loadLevel={loadLevel}
        onChange={setLoadLevel}
        batteryLevel={batteryLevel}
        outsideTemp={outsideTemp}
        activeSimulation={activeSimulation}
        onToggleSimulation={handleToggleSimulation}
        voiceMuted={voiceMuted}
        onToggleVoiceMuted={() => setVoiceMuted((m) => !m)}
      />
    </div>
  )
}

export default App
