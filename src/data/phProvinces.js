// Provinces by region, for the For Hospitals request form's dropdowns
// (2026-11-25). Region keys match PH_REGIONS (src/utils/hospitalConfig.js).
//
// - NIR (Negros Island Region, RA 12000 of 2024): Negros Occidental from
//   Region VI, Negros Oriental and Siquijor from Region VII.
// - BARMM provinces come from src/utils/barmm.js (one source). Sulu is left
//   out: the Supreme Court excluded it from BARMM (2024) and no other region
//   has been designated, so a Sulu hospital uses "Other (not listed)".
// - NCR has no provinces; its cities are listed instead (NCR_CITIES).
// - Highly urbanized and independent cities sit under their province here
//   (the city itself is typed, or chosen from the BARMM / NCR lists).
import { BARMM_PROVINCES, BARMM_MUNICIPALITIES } from '../utils/barmm'

export const NCR_PROVINCE = 'Metro Manila'

export const PROVINCES_BY_REGION = {
  'NCR':         [NCR_PROVINCE],
  'CAR':         ['Abra', 'Apayao', 'Benguet', 'Ifugao', 'Kalinga', 'Mountain Province'],
  'Region I':    ['Ilocos Norte', 'Ilocos Sur', 'La Union', 'Pangasinan'],
  'Region II':   ['Batanes', 'Cagayan', 'Isabela', 'Nueva Vizcaya', 'Quirino'],
  'Region III':  ['Aurora', 'Bataan', 'Bulacan', 'Nueva Ecija', 'Pampanga', 'Tarlac', 'Zambales'],
  'Region IV-A': ['Batangas', 'Cavite', 'Laguna', 'Quezon', 'Rizal'],
  'MIMAROPA':    ['Marinduque', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Romblon'],
  'Region V':    ['Albay', 'Camarines Norte', 'Camarines Sur', 'Catanduanes', 'Masbate', 'Sorsogon'],
  'Region VI':   ['Aklan', 'Antique', 'Capiz', 'Guimaras', 'Iloilo'],
  'NIR':         ['Negros Occidental', 'Negros Oriental', 'Siquijor'],
  'Region VII':  ['Bohol', 'Cebu'],
  'Region VIII': ['Biliran', 'Eastern Samar', 'Leyte', 'Northern Samar', 'Samar', 'Southern Leyte'],
  'Region IX':   ['Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay'],
  'Region X':    ['Bukidnon', 'Camiguin', 'Lanao del Norte', 'Misamis Occidental', 'Misamis Oriental'],
  'Region XI':   ['Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental'],
  'Region XII':  ['Cotabato', 'Sarangani', 'South Cotabato', 'Sultan Kudarat'],
  'Caraga':      ['Agusan del Norte', 'Agusan del Sur', 'Dinagat Islands', 'Surigao del Norte', 'Surigao del Sur'],
  'BARMM':       BARMM_PROVINCES,
}

// The 16 cities and 1 municipality of Metro Manila.
export const NCR_CITIES = [
  'Caloocan', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila', 'Marikina',
  'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig', 'Pateros', 'Quezon City',
  'San Juan', 'Taguig', 'Valenzuela',
]

// The city/municipality list for a province, when MAPA has one (BARMM and
// Metro Manila); otherwise null and the form takes a typed city.
export function citiesFor(region, province) {
  if (region === 'NCR' && province === NCR_PROVINCE) return NCR_CITIES
  if (region === 'BARMM' && BARMM_MUNICIPALITIES[province]) return BARMM_MUNICIPALITIES[province]
  return null
}
