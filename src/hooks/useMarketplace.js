import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { usePublicHospitals } from './usePublicHospitals'
import { agencyPartnersWith } from '../utils/hospitals'
import { effectiveSlots } from '../utils/requests'
import { phTodayKey } from '../utils/dates'

// Fewer finished cases than this and a turnaround figure says more about luck
// than about the hospital; networkStats publishes nothing below it either.
export const MIN_TURNAROUND_SAMPLE = 5

/**
 * The patient marketplace (docs/patient-marketplace-plan.md): every hospital
 * taking patients, with what a patient compares before choosing where to file:
 *   - partners   the agencies its gateway can endorse to (agencyPartnersWith)
 *   - programs   the assistance types those agencies fund
 *   - slots      the partners' remaining / total slots (capacity right now)
 *   - stats      hospitalsPublicStats: typical days from filing to endorsement
 * plus the office, address, region and contact from hospitalsPublic.
 */
export function useMarketplace() {
  const hospitals = usePublicHospitals()
  const [agencies, setAgencies] = useState([])
  const [stats, setStats]       = useState({})
  const [agenciesReady, setAgenciesReady] = useState(false)

  useEffect(() => onSnapshot(
    query(collection(db, 'agencies'), where('enabled', '==', true)),
    (snap) => { setAgencies(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setAgenciesReady(true) },
    (err) => { console.error('[marketplace] agencies:', err); setAgenciesReady(true) },
  ), [])

  useEffect(() => {
    getDocs(collection(db, 'hospitalsPublicStats'))
      .then((snap) => setStats(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))))
      .catch(() => {})   // no stats yet → cards just omit turnaround
  }, [])

  const list = useMemo(() => hospitals.map((h) => {
    const partners = agencies
      .filter((a) => agencyPartnersWith(a, h.id))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    const programs = [...new Set(partners.flatMap((a) => a.assistanceTypes ?? []))].sort()
    // Today's slots: the daily reset is written lazily, so a figure from an
    // earlier day means the agency has refilled (effectiveSlots).
    const today = phTodayKey()
    const slots = partners.reduce((acc, a) => {
      const s = effectiveSlots(a, today, h.id)
      return { remaining: acc.remaining + s.remaining, total: acc.total + s.total }
    }, { remaining: 0, total: 0 })
    const s = stats[h.id]
    const turnaround = s && typeof s.turnaroundDays === 'number' && Number(s.basedOn) >= MIN_TURNAROUND_SAMPLE
      ? { days: Number(s.turnaroundDays), basedOn: Number(s.basedOn) }
      : null
    return { ...h, partners, programs, slots, turnaround }
  }), [hospitals, agencies, stats])

  return { hospitals: list, loading: !agenciesReady }
}

// The hospital whose access-code prefix starts `code` (a scanned slip).
export const hospitalForCode = (hospitals, code) => {
  const c = String(code ?? '').toUpperCase()
  return hospitals.find((h) => h.accessCodePrefix && c.startsWith(`${h.accessCodePrefix.toUpperCase()}-`)) ?? null
}
