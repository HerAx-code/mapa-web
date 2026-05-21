import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { MdShield, MdArrowForward, MdDownload, MdClose } from 'react-icons/md'
import toast from 'react-hot-toast'

const DASHBOARD = {
  [ROLES.PATIENT]:      '/patient/dashboard',
  [ROLES.AGENCY]:       '/agency/dashboard',
  [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
  [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
  [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
}

export default function Landing() {
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const featuresRef = useRef(null)

  const [showPrivacy, setShowPrivacy] = useState(false)
  const [agencies, setAgencies]       = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'agencies'), where('enabled', '==', true)),
      snap => setAgencies(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.name?.localeCompare(b.name))
      ),
      () => {}
    )
    return unsub
  }, [])

  const handleMainCTA = () => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard')
    else navigate('/register')
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Topbar */}
      <header className="border-b border-gray-100 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <MdShield size={18} className="text-white" />
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-900">MAPA</span>
            <span className="text-xs text-gray-400 ml-1">CRMC</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            className="btn-secondary flex items-center justify-center gap-1.5 text-sm"
            onClick={() => toast('📱 The MAPA mobile app is coming soon. Follow CRMC for updates.', {
              duration: 4000,
              icon: '🚀',
            })}>
            <MdDownload size={16} />
            Download App
          </button>
          {!user && (
            <button
              className="btn-secondary w-full sm:w-auto text-sm"
              onClick={() => navigate('/register')}>
              Register
            </button>
          )}
          <button
            className="btn-primary w-full sm:w-auto"
            onClick={() => user ? navigate(DASHBOARD[user.role] ?? '/') : navigate('/login')}>
            {user ? 'Dashboard →' : 'Log In →'}
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-50 to-white py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white border border-brand-100 rounded-full px-4 py-1.5 text-xs text-brand-600 font-medium mb-6 shadow-sm">
            <MdShield size={14} />
            Official portal of Cotabato Regional Medical Center
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            <span className="text-brand-500">M</span>edical{' '}
            <span className="text-brand-500">A</span>ssistance{' '}
            <span className="text-brand-500">P</span>ortal{' '}
            <span className="text-brand-500">A</span>ccess
          </h1>
          <p className="text-gray-500 text-base mb-2 flex items-center justify-center gap-2">
            <span>📍</span> Sinsuat Avenue, Cotabato City
          </p>
          <p className="text-gray-600 text-lg mb-8 max-w-xl mx-auto">
            Simplifying access to medical financial assistance programs at CRMC for patients, agencies, and administrators.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              className="btn-primary flex items-center justify-center gap-2 px-6 py-2.5 text-base w-full sm:w-auto"
              onClick={handleMainCTA}>
              {user ? 'Go to Dashboard' : 'Apply for Patient Account'}
              <MdArrowForward size={18} />
            </button>
            <button
              className="btn-secondary px-6 py-2.5 text-base w-full sm:w-auto"
              onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              Learn More ↓
            </button>
          </div>
        </div>
      </section>

      {/* What to prepare — only shown to unauthenticated visitors */}
      {!user && <section className="py-10 px-6 bg-brand-500">
        <div className="max-w-4xl mx-auto">
          <p className="text-white text-center text-sm font-semibold uppercase tracking-widest mb-6 opacity-80">
            Before you register, prepare the following
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { emoji: '🪪', title: 'Patient Access Code', desc: 'Your CRMC Patient Access Code (CRMC-YYYY-XXXXX). Get this from CRMC Medical Social Services.' },
              { emoji: '📧', title: 'Email Address',       desc: 'A working email address for account login, notifications, and password recovery.' },
              { emoji: '📱', title: 'Mobile Number',       desc: 'Your 11-digit Philippine mobile number (e.g. 09XXXXXXXXX).' },
              { emoji: '📍', title: 'Home Address',        desc: 'Your complete address — barangay, municipality, and province. Appears on your certificate.' },
            ].map((item, i) => (
              <div key={i} className="bg-white/10 rounded-xl p-4 text-center">
                <p className="text-2xl mb-2">{item.emoji}</p>
                <p className="text-white text-xs font-semibold mb-1">{item.title}</p>
                <p className="text-white/70 text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          {!user && (
            <p className="text-center text-white/60 text-xs mt-6">
              Already have these ready?{' '}
              <button onClick={() => navigate('/register')}
                className="text-white font-semibold underline underline-offset-2 hover:opacity-80">
                Register now →
              </button>
            </p>
          )}
        </div>
      </section>}

      {/* How MAPA Works — step-by-step, only for new visitors */}
      {!user && <section ref={featuresRef} className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">How to Get Medical Assistance</h2>
          <p className="text-gray-500 text-center text-sm mb-12">
            Follow these steps to successfully apply for and receive medical assistance through CRMC.
          </p>

          {/* Steps grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { step: 1, emoji: '🪪', title: 'Get your Patient Access Code', desc: 'Visit CRMC Medical Social Services to be assessed and receive your Patient Access Code.' },
              { step: 2, emoji: '📝', title: 'Create a Patient Account',   desc: 'Register online using your Hospital ID, email address, contact number, and home address.' },
              { step: 3, emoji: '📄', title: 'Upload Your Documents',      desc: 'Submit scanned copies of your required documents through the portal for verification.' },
              { step: 4, emoji: '🏥', title: 'Apply for a Program',        desc: 'Browse available medical assistance programs and submit your application to your chosen agency.' },
              { step: 5, emoji: '🎥', title: 'Attend Your Interview',      desc: 'Join a scheduled online video interview with the agency to discuss your application.' },
              { step: 6, emoji: '🏆', title: 'Receive Your Certificate',   desc: 'Download your official Certificate of Medical Assistance and present it at the agency office.' },
            ].map((s, i, arr) => (
              <div key={s.step} className="relative flex gap-4">
                {/* Step number */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-brand-500 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {s.step}
                  </div>
                  {/* Vertical connector on mobile */}
                  {i < arr.length - 1 && (
                    <div className="w-0.5 flex-1 bg-brand-100 mt-2 min-h-[24px] sm:hidden" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-6 sm:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.emoji}</span>
                    <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA below steps */}
          {!user && (
            <div className="text-center mt-10">
              <button
                onClick={() => navigate('/register')}
                className="btn-primary px-8 py-2.5 text-base flex items-center gap-2 mx-auto">
                Start with Step 1 <MdArrowForward size={18} />
              </button>
              <p className="text-xs text-gray-400 mt-2">Free · No fees required · Powered by CRMC</p>
            </div>
          )}
        </div>
      </section>}

      {/* Available Programs */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Available Programs</h2>
              <p className="text-sm text-gray-500 mt-1">
                Browse active medical assistance programs at CRMC. Slots reset daily at midnight.
              </p>
            </div>
            <button
              className="btn-primary text-sm w-full sm:w-auto"
              onClick={handleMainCTA}>
              {user ? 'Go to Dashboard →' : 'Apply Now →'}
            </button>
          </div>
          {agencies.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-xl flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 rounded w-36" />
                      <div className="h-2.5 bg-gray-100 rounded w-24" />
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agencies.map(agency => {
                const total     = agency.slots?.total ?? 0
                const remaining = agency.slots?.remaining ?? 0
                const pct       = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0
                const isFull    = remaining === 0
                const isLow     = !isFull && total > 0 && remaining / total <= 0.25
                return (
                  <div key={agency.id} className="card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 ${agency.color ?? 'bg-gray-400'} rounded-xl text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                        {agency.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                        <p className="text-xs text-gray-400 truncate">{agency.location}</p>
                      </div>
                      <span className={`badge text-xs ${isFull ? 'badge-red' : isLow ? 'badge-amber' : 'badge-green'}`}>
                        {isFull ? 'Full' : `${remaining} slots`}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1">
                      <div
                        className={`h-1.5 rounded-full transition-all ${isFull ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400">{remaining} of {total} slots remaining today</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white pt-12 pb-6 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Top section — 3 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <MdShield size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold">MAPA</p>
                  <p className="text-xs text-gray-400">Medical Assistance Portal Access</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                The official online portal of Cotabato Regional Medical Center for processing medical assistance applications.
              </p>
            </div>

            {/* Quick links */}
            <div>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest mb-3">Quick Links</p>
              <ul className="space-y-2">
                {!user && (
                  <>
                    <li>
                      <button onClick={() => navigate('/register')}
                        className="text-xs text-gray-400 hover:text-white transition-colors">
                        Register as Patient
                      </button>
                    </li>
                    <li>
                      <button onClick={() => navigate('/login')}
                        className="text-xs text-gray-400 hover:text-white transition-colors">
                        Log In
                      </button>
                    </li>
                  </>
                )}
                {user && (
                  <li>
                    <button onClick={() => navigate(DASHBOARD[user.role] ?? '/')}
                      className="text-xs text-gray-400 hover:text-white transition-colors">
                      Go to Dashboard
                    </button>
                  </li>
                )}
                <li>
                  <button
                    onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-xs text-gray-400 hover:text-white transition-colors">
                    How It Works
                  </button>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest mb-3">Contact Us</p>
              <ul className="space-y-2 text-xs text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5">📍</span>
                  <span>Sinsuat Avenue, Cotabato City,<br />Maguindanao del Norte 9600</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>📞</span>
                  <span>(064) 421-2500</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>✉️</span>
                  <span>records@crmc.gov.ph</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>🕐</span>
                  <span>Mon – Fri, 8:00 AM – 5:00 PM</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-gray-700 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              © {new Date().getFullYear()} MAPA · Cotabato Regional Medical Center · All rights reserved
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <button
                onClick={() => setShowPrivacy(true)}
                className="hover:text-gray-300 transition-colors">
                Privacy Notice
              </button>
              <span>·</span>
              <span>CRMC Official Portal</span>
            </div>
          </div>
        </div>
      </footer>
      {/* Privacy Notice Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowPrivacy(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Privacy Notice</h2>
              <button onClick={() => setShowPrivacy(false)} className="text-gray-400 hover:text-gray-600">
                <MdClose size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-4 text-sm">
              <p className="text-xs text-gray-500">
                This notice explains what information MAPA collects, how it is used, and who can access it.
                MAPA is operated by Cotabato Regional Medical Center (CRMC) in compliance with the Philippine
                Data Privacy Act of 2012 (Republic Act 10173).
              </p>
              {[
                { title: 'Data We Collect', items: ['Full name, email address, and contact number', 'CRMC Hospital ID and patient ID number', 'Documents uploaded for verification', 'Application submissions and status history', 'Messages with administrators and agency staff'] },
                { title: 'How Your Data is Used', items: ['To process medical assistance applications', 'To verify eligibility for assistance programs', 'To communicate application updates and schedules', 'To generate official Certificates of Medical Assistance', 'To comply with government record-keeping regulations'] },
                { title: 'Who Has Access', items: ['You — your own data only', 'Agency Coordinators — applications submitted to their agency', 'Staff Administrators — documents and applications for review', 'System Administrators — full access for management and audit'] },
              ].map((sec, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{sec.title}</p>
                  <ul className="space-y-1">
                    {sec.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="text-brand-400 flex-shrink-0 mt-0.5">•</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  For data concerns, contact the <strong>CRMC Records Office</strong> at records@crmc.gov.ph or call (064) 421-2500.
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0">
              <button className="btn-secondary text-sm w-full" onClick={() => setShowPrivacy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
