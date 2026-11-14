import { useMemo } from 'react'
import { MdLocalHospital } from 'react-icons/md'
import { useHospitals, hospitalLabel } from '../../hooks/useHospitals'
import { breakdownByHospital, hospitalsIn } from '../../utils/hospitalBreakdown'

// Multi-hospital agency views. Both render NOTHING while an agency's slices
// come from a single hospital, so a one-hospital network looks exactly as
// before; they appear once a second partner hospital endorses to the agency.

const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString('en-PH')}`

function useHospitalName() {
  const { hospitals } = useHospitals()
  return (id) => hospitalLabel(hospitals.find((h) => h.id === id)) || id
}

// "By hospital" card: queue, approved and pesos approved per partner hospital.
export function HospitalBreakdownCard({ slices, className = '' }) {
  const rows = useMemo(() => breakdownByHospital(slices), [slices])
  const nameOf = useHospitalName()
  if (rows.length < 2) return null
  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <MdLocalHospital size={16} className="text-gray-500" />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">By hospital</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 text-left">
              <th className="font-medium py-1.5 pr-3">Hospital</th>
              <th className="font-medium py-1.5 px-3 text-right">In queue</th>
              <th className="font-medium py-1.5 px-3 text-right">Approved</th>
              <th className="font-medium py-1.5 pl-3 text-right">Amount approved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => (
              <tr key={r.tenantId}>
                <td className="py-2 pr-3 text-gray-800 font-medium">{nameOf(r.tenantId)}</td>
                <td className={`py-2 px-3 text-right tabular-nums ${r.inQueue ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>{r.inQueue}</td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-800">{r.approved}</td>
                <td className="py-2 pl-3 text-right tabular-nums text-gray-800">{peso(r.amountApproved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Hospital filter for slice lists (Logs, Funds). `value` 'all' or a tenantId.
export function HospitalFilterSelect({ slices, value, onChange, className = '' }) {
  const ids = useMemo(() => hospitalsIn(slices), [slices])
  const nameOf = useHospitalName()
  if (ids.length < 2) return null
  return (
    <select className={`input w-auto flex-shrink-0 ${className}`} aria-label="Filter by hospital"
      value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All hospitals</option>
      {ids.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
    </select>
  )
}

// Small hospital label for a slice row; hidden in a one-hospital network.
export function useSliceHospitalLabel(slices) {
  const many = useMemo(() => hospitalsIn(slices).length > 1, [slices])
  const nameOf = useHospitalName()
  return (tenantId) => (many ? nameOf(tenantId) : null)
}
