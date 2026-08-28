import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { MdChevronRight, MdDescription, MdAssignment, MdFlag, MdGroup, MdBadge, MdListAlt } from 'react-icons/md'

// ── Export row component ──────────────────────────────────────────────────

function ExportRow({ icon: Icon, iconBg, title, description, slug }) {
  const navigate = useNavigate()

  return (
    <button
      className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      onClick={() => navigate(`/admin/export/${slug}`)}>
      <div className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <MdChevronRight size={20} className="text-gray-300 flex-shrink-0" />
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ExportPage() {
  const sections = [
    {
      icon:        MdDescription,
      iconBg:      'bg-brand-500',
      title:       'Document Review',
      description: 'Patient document submissions and their verification status.',
      slug:        'documents',
    },
    {
      icon:        MdAssignment,
      iconBg:      'bg-blue-500',
      title:       'Applications (Full Record)',
      description: 'Complete application records including patient contact, agency, and update history.',
      slug:        'applications-full',
    },
    {
      icon:        MdListAlt,
      iconBg:      'bg-purple-500',
      title:       'Applications (Log View)',
      description: 'Simplified audit trail — application ID, patient, agency, status, and submitted date.',
      slug:        'applications-log',
    },
    {
      icon:        MdFlag,
      iconBg:      'bg-red-500',
      title:       'Problem Reports',
      description: 'Issues and feedback submitted by portal users.',
      slug:        'reports',
    },
    {
      icon:        MdGroup,
      iconBg:      'bg-teal-500',
      title:       'Patients',
      description: 'Registered patient accounts and their profile information.',
      slug:        'patients',
    },
    {
      icon:        MdBadge,
      iconBg:      'bg-amber-500',
      title:       'Patient Access Codes',
      description: 'Issued access codes and their usage status — which codes have been claimed by patients.',
      slug:        'hospitalids',
    },
  ]

  return (
    <Layout breadcrumb="Export">
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <p className="eyebrow">Data</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Export Data</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select a data type to open the full export view where you can filter, search, and download.
          </p>
        </div>

        {/* Export list */}
        <div className="card overflow-hidden divide-y divide-gray-100 mb-6">
          {sections.map(s => (
            <ExportRow key={s.slug} {...s} />
          ))}
        </div>

        {/* Privacy footer */}
        <div className="card p-4">
          <p className="text-xs text-gray-500 text-center">
            All exported files contain personal data protected under{' '}
            <strong>Republic Act No. 10173</strong> (Data Privacy Act of 2012).
            Handle exported files in accordance with CRMC data privacy policy.
            Do not share or distribute without proper authorization.
          </p>
        </div>

      </div>
    </Layout>
  )
}
