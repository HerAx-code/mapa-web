import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  MdExpandMore, MdExpandLess, MdSearch, MdMenuBook,
  MdInbox, MdCardMembership, MdBarChart, MdVideoCall,
  MdListAlt, MdMessage, MdUnfoldMore, MdUnfoldLess,
} from 'react-icons/md'

const LAST_UPDATED = '2026-05-19'

// ── Sections (Glossary lives here too, no special-case rendering) ──────────

const SECTIONS = [
  // ── Orientation ─────────────────────────────────────────────────
  {
    id: 'overview',
    group: 'Orientation',
    icon: '📘',
    title: 'How MAPA works for your agency',
    content:
      `MAPA (Medical Assistance Portal Access) digitizes the financial medical assistance process for CRMC. ` +
      `As an agency coordinator (social worker), you receive applications from patients, conduct case assessment, ` +
      `interview applicants via Google Meet, decide on approval with a specific guaranteed amount, and issue a ` +
      `Guarantee Letter that the named provider redeems with your agency.\n\n` +
      `MAPA does not move money — it records commitments. Actual settlement happens off-system between your ` +
      `agency and the provider.`,
  },
  {
    id: 'lifecycle',
    group: 'Orientation',
    icon: '🔄',
    title: 'Application lifecycle',
    items: [
      { label: 'Pending',     desc: 'Patient submitted. Slot was auto-deducted. Awaiting your first review.' },
      { label: 'Reviewing',   desc: 'You clicked Start Review. Schedule the interview, conduct it, then open the Assessment to record what you learned.' },
      { label: 'Interview',   desc: 'You scheduled a Google Meet interview. Date, time, link, and conducting social worker are recorded.' },
      { label: 'Approved',    desc: 'You issued the approval with amount, purpose, and payable-to. GL status: Issued. Committed budget incremented.' },
      { label: 'Certificate', desc: 'GL has been printed and confirmed. The patient is notified. Upload the wet-signed scan so the patient can download it.' },
      { label: 'Rejected',    desc: 'Application denied. Reason is sent to the patient.' },
    ],
  },
  {
    id: 'glossary',
    group: 'Orientation',
    icon: '📖',
    title: 'Glossary — key terms',
    items: [
      { label: 'Patient Access Code',   desc: 'CRMC-YYYY-NNNNN code issued by Medical Social Services. Patients must enter it to register.' },
      { label: 'Application',           desc: 'A request from a patient for assistance from a specific agency. Has a status: pending → reviewing → interview → approved → certificate (or rejected).' },
      { label: 'Case Assessment',      desc: 'A long form the social worker fills in during or after the patient interview, recording family/income/medical details and a recommendation. Required before approval. (Printed copy retains the official "Unified Intake Sheet" header for COA audit purposes.)' },
      { label: 'Means-Test Category',   desc: 'Manual classification of the patient: Indigent / Marginalized / Low Income / Above Threshold.' },
      { label: 'Guarantee Letter (GL)', desc: 'The official document issued to an approved patient. States the guaranteed amount, the purpose, and the provider that will be billed.' },
      { label: 'GL Status',             desc: 'Issued (just approved), Redeemed (provider billed back), or Expired (30-day window passed).' },
      { label: 'Committed Budget',      desc: 'Total money approved but not yet redeemed. Subtracted from your allocation.' },
      { label: 'Disbursed Budget',      desc: 'Total money where the provider has billed back. Final spend.' },
      { label: 'Cooldown',              desc: '30-day window during which a patient cannot easily be re-approved. Warning shows in the approval modal if a recent approval is on record.' },
    ],
  },

  // ── Daily processing ────────────────────────────────────────────
  {
    id: 'inbox',
    group: 'Daily Processing',
    icon: '📥',
    title: 'Working the Inbox',
    steps: [
      'Open Application Inbox from the sidebar. The badge shows pending + reviewing applications.',
      'Each row shows: patient name, app ID, days waiting, document count, intake status, status badge.',
      'Click a row to open the four-tab detail modal: Overview, Assessment, Documents, Timeline & Notes.',
      'The Message icon on the right opens a chat with the patient. The blue button reads "Review" or "View" based on status.',
      'Summary cards at the top filter the list by status — click "Pending" to focus your queue.',
    ],
    note: 'Days-waiting on each row turns amber at 3+ days and red at 7+ days. Tackle red rows first.',
  },
  {
    id: 'start-review',
    group: 'Daily Processing',
    icon: '▶️',
    title: 'Start reviewing a pending application',
    steps: [
      'Click a Pending row → the application detail modal opens on the Overview tab.',
      'Verify patient info, attached documents (Documents tab), and any past notes.',
      'Click Start Review in the action footer. Status becomes Reviewing and the patient is notified.',
      'The Assessment tab unlocks. Schedule the interview first, then open the Assessment to record what you learn during/after the interview.',
    ],
  },
  {
    id: 'intake',
    group: 'Daily Processing',
    icon: '📋',
    title: 'Completing the Case Assessment',
    content:
      `The Case Assessment is the digital equivalent of CRMC's paper Client's Information Sheet + Social Case Study. ` +
      `Fill it during or after the patient interview — the data here comes from what the patient tells you, not from ` +
      `the application documents alone. It must be completed before approval — the Approve button stays disabled until ` +
      `6 required fields are filled: Household Size, Monthly Income, Diagnosis, Recommendation, Means-Test Category, ` +
      `and Author (auto-filled). The printed copy retains the official "Unified Intake Sheet" header for COA audit purposes.`,
    steps: [
      'Schedule and conduct the patient interview first.',
      'Open the application → Assessment tab → click Open Assessment.',
      'Fill family composition (one row per member), income and employment, monthly expenses.',
      'Fill medical details: diagnosis (required), attending physician, hospital case number (IHOMIS reference), estimated cost.',
      'Write the social case study narrative (free text) and your recommendation (required).',
      'Pick the means-test category (required): Indigent / Marginalized / Low Income / Above Threshold.',
      'Save. The assessment chip on the Inbox row turns green when complete.',
    ],
    note: 'You can save partial progress at any time and return after a follow-up call. Empty optional fields are fine — mirror what you would write on paper.',
  },
  {
    id: 'interview',
    group: 'Daily Processing',
    icon: '🎥',
    title: 'Scheduling an interview',
    steps: [
      'In the Inbox app modal, click Schedule Interview (only available on Reviewing status).',
      'Create a Google Meet link in advance at meet.google.com.',
      'Enter date, time, the Meet link, and your name as the conducting social worker.',
      'Click Schedule Interview. The patient is notified with the date, time, and Meet link.',
      'The interview also appears on the Online Interviews page.',
    ],
    note: 'To reschedule: open the application → Overview tab → click Reschedule in the purple interview panel, or use the Reschedule outcome action.',
  },
  {
    id: 'outcome',
    group: 'Daily Processing',
    icon: '✍️',
    title: 'Recording an interview outcome',
    content:
      `After the Google Meet ends, record what happened — this is required so the application can move forward.`,
    steps: [
      'Open the application (or open it on the Online Interviews page).',
      'In the Overview tab\'s purple interview panel, click one of three buttons:',
      '  • Mark Completed — interview went as planned. Add observations in notes.',
      '  • No-Show — patient missed the interview. The patient is notified to contact you.',
      '  • Reschedule — pick a new date/time and Meet link.',
      'Save. The outcome and any notes are recorded permanently.',
    ],
    note: 'Outcomes can be edited after saving — open the application again and click "Edit outcome" on the Interviews page.',
  },

  // ── Approval and GL ────────────────────────────────────────────
  {
    id: 'approve',
    group: 'Approval & Guarantee Letter',
    icon: '✅',
    title: 'Approving and issuing a Guarantee Letter',
    content:
      `The Approve & Issue GL action captures three pieces of information: the guaranteed amount, the purpose, ` +
      `and the provider (Payable To). The application moves to Approved, the agency's committed budget increases ` +
      `by the approved amount, and the patient is notified.`,
    steps: [
      'In the application modal, click Approve & Issue GL (only available after the Case Assessment is complete).',
      'Review the budget remaining banner — your approval cannot exceed this amount.',
      'If a cooldown warning appears (a recent approval for the same patient), decide whether to proceed.',
      'Enter the approved amount in pesos. Validation blocks amounts exceeding the remaining budget.',
      'Pick one or more purposes from your agency\'s assistance types.',
      'Enter the provider name (Payable To) — e.g. "CRMC Billing Department", "Mercury Drug Cotabato".',
      'Click Approve & Issue GL. The committed budget increments and the patient is notified.',
    ],
    note: 'Approve only what your agency can actually fund. The budget enforcement is real — exceeding it is blocked.',
  },
  {
    id: 'reject',
    group: 'Approval & Guarantee Letter',
    icon: '⛔',
    title: 'Rejecting an application',
    steps: [
      'Open the application → click Reject in the action footer.',
      'Pick a template reason (Incomplete documents, Income ineligible, etc.) or write a custom reason.',
      'Click Confirm Reject. The patient is notified with the exact reason.',
      'If the application was submitted today, the slot is automatically restored.',
    ],
    note: 'Be specific so the patient knows what to correct before reapplying.',
  },
  {
    id: 'print-upload',
    group: 'Approval & Guarantee Letter',
    icon: '🖨️',
    title: 'Printing and uploading the Guarantee Letter',
    content:
      `After approval, the Guarantee Letter has its own dedicated viewer page. From there you can print to a physical printer for wet-signing, or save as a true vector PDF using the browser's "Save as PDF" option.`,
    items: [
      { label: 'Open GL Viewer', desc: 'From the application detail (or the Guarantee Letters page), click "Open GL Viewer" to see the full GL rendered exactly as it will print.' },
      { label: 'Print',          desc: 'On the viewer page, click Print. The browser print dialog opens — pick your physical printer for wet-signing on paper.' },
      { label: 'Save as PDF',    desc: 'On the viewer page, click Save as PDF. The same print dialog opens — pick "Save as PDF" as the destination to get a real vector PDF (selectable text, crisp graphics) on disk.' },
      { label: 'Upload Signed Scan', desc: 'After wet-signing the printed copy, scan or photograph it (JPG/PNG, ≤4 MB) and upload via the "Upload Signed Scan" button. The patient can then download the signed copy from their Track Status page.' },
    ],
    steps: [
      'Open the application → Guarantee Letter section → click Open GL Viewer.',
      'On the viewer, click Print (for paper) or Save as PDF (then pick "Save as PDF" in the print dialog).',
      'Return to the application and confirm "Yes, mark as Issued" only after the print/save actually succeeds — that flips the application to Guarantee Letter Issued.',
      'Wet-sign the printed copy on paper. (MAPA never generates a "pre-signed" file — the wet signature is the legal step.)',
      'Scan or photograph the signed page, then click Upload Signed Scan to attach it. The patient is notified that the signed copy is ready to download.',
    ],
    note: 'The viewer renders natively in the browser, so the PDF you save is pixel-identical to what you see on screen — no rasterization or quality loss.',
  },
  {
    id: 'gl-lifecycle',
    group: 'Approval & Guarantee Letter',
    icon: '♻️',
    title: 'GL lifecycle: redemption, expiry, reversal',
    content: `A Guarantee Letter is "Issued" when approved, valid for 30 days. Three things can happen next:`,
    items: [
      { label: 'Redeemed', desc: 'The named provider billed back for the amount. In the Inbox app modal, click Mark GL Redeemed. Budget moves from committed → disbursed.' },
      { label: 'Expired',  desc: '30 days passed without redemption. The Inbox row and app modal show "Expired (action needed)". Click Mark GL Expired to release the committed budget back to your allocation.' },
      { label: 'Reversed', desc: 'You made a mistake (wrong amount, wrong provider). Click Reverse Approval in the app modal. The application returns to Reviewing, the committed budget is released, the patient is notified.' },
    ],
    note: 'Always close the loop. Unredeemed GLs that never get marked expired will lock your committed budget indefinitely.',
  },

  // ── Operations ─────────────────────────────────────────────────
  {
    id: 'slots',
    group: 'Operations',
    icon: '🎫',
    title: 'Daily slot management',
    steps: [
      'Open Slot Management from the sidebar.',
      'Default Slot Capacity is your daily cap (max 100). Edit to change it.',
      'Today\'s Slots shows current remaining/total with a backlog indicator if there are unprocessed apps.',
      'Slots auto-deduct when patients submit applications. They reset to default at the start of each new day, applied when the first coordinator opens the workspace.',
      'For walk-ins or corrections, use Manual Adjustment. Add a reason — every change is logged in the audit trail.',
      'Recent Adjustments shows the last 10 changes with author and time.',
    ],
    note: 'Reject-today restores the slot automatically. Manual deduct is for walk-ins not submitted through the portal.',
  },
  {
    id: 'budget',
    group: 'Operations',
    icon: '💰',
    title: 'Budget, cooldown, and fiscal control',
    content:
      `Your agency has a budget allocation set by your Agency Administrator. The Approve modal validates each ` +
      `approved amount against it, so over-approval is impossible. The Dashboard and Funds pages show your ` +
      `remaining budget in real time. CRMC operates the platform but does not control your agency's budget.`,
    items: [
      { label: 'Allocated',    desc: 'Total budget for the period (monthly, quarterly, or yearly). Set by your Agency Administrator on /agency/allocation.' },
      { label: 'Committed',    desc: 'Sum of all approved-but-not-redeemed GL amounts. Decreases when a GL is redeemed, expired, or reversed.' },
      { label: 'Disbursed',    desc: 'Sum of all redeemed GL amounts. Final spend.' },
      { label: 'Remaining',    desc: 'Allocated − Committed. This is what your next approval can draw from.' },
      { label: 'Period reset', desc: 'Your Agency Administrator starts a new period via /agency/allocation → Reset Period. Committed and disbursed reset to ₱0; allocation remains.' },
      { label: 'Cooldown',     desc: 'Hard 30-day check: if the patient was already approved (by any agency) in the past 30 days, the Approve button is disabled. Reversed approvals also keep the cooldown clock running.' },
    ],
  },
  {
    id: 'message',
    group: 'Operations',
    icon: '💬',
    title: 'Messaging a patient',
    steps: [
      'From the Inbox, click the chat icon next to a row to open a conversation directly.',
      'Or open the application modal → click Message Patient in the footer → type → Send.',
      'All conversations are listed under Messages in the sidebar.',
      'The patient receives an in-portal notification and can reply.',
    ],
  },
  {
    id: 'notes',
    group: 'Operations',
    icon: '📝',
    title: 'Adding case notes',
    content:
      `Case notes are an append-only log on the application — distinct from the Case Assessment narrative. ` +
      `Use them for ongoing observations: "Called patient on 5/19, voicemail" or "Provider confirmed receipt of GL".`,
    steps: [
      'Open the application → Timeline & Notes tab.',
      'Type your note in the textarea (up to 500 characters).',
      'Click Add. The note is permanent (no edit/delete).',
      'Notes are visible to your agency\'s coordinators and to admins for audit.',
    ],
  },
  {
    id: 'logs',
    group: 'Operations',
    icon: '📑',
    title: 'Application Logs and history',
    steps: [
      'Open Application Logs from the sidebar.',
      'All applications — current and past — are listed.',
      'Filter by status tab (Pending/Reviewing/Interview/Approved/Rejected/Certificate) or search by name/contact/app ID.',
      'Export CSV downloads the current filtered list for reporting.',
    ],
    note: 'The audit trail of every status change, slot adjustment, and GL action is stored separately in the admin Audit Log.',
  },

  // ── FAQ ────────────────────────────────────────────────────────
  {
    id: 'faq',
    group: 'FAQ',
    icon: '❓',
    title: 'Common problems',
    items: [
      { label: 'The Approve button is disabled',     desc: 'The Case Assessment is incomplete. Open it and fill the 6 required fields.' },
      { label: 'My approval was blocked',            desc: 'You tried to approve more than the agency\'s remaining budget. Lower the amount or ask the admin to increase the allocation.' },
      { label: 'I see "GL Expired (action needed)"', desc: 'A GL passed its 30-day validity window. Open the app and click Mark GL Expired to release the committed budget.' },
      { label: 'A patient says they didn\'t get the notification', desc: 'Check Messages and send a direct message. The patient may not have logged in to the portal yet.' },
      { label: 'I approved by mistake',              desc: 'Open the app → click Reverse Approval. The committed budget is released and the application returns to Reviewing.' },
      { label: 'The print window cancelled',         desc: 'Answer "Not yet" on the confirmation prompt. The application stays at Approved so you can retry.' },
      { label: 'No budget allocated message',        desc: 'Ask the system administrator to set a budget on the Agency Detail page.' },
    ],
  },
  {
    id: 'support',
    group: 'FAQ',
    icon: '🆘',
    title: 'Getting help',
    content:
      `For technical issues with the portal (broken page, error message), use the Report a Problem option ` +
      `in the user menu (top-right). For account access issues, contact your system administrator. ` +
      `For patient-related concerns, use the Messages feature to reach the patient directly.`,
  },
]

const GROUPS = ['Orientation', 'Daily Processing', 'Approval & Guarantee Letter', 'Operations', 'FAQ']

const QUICK_LINKS = [
  { label: 'Application Inbox', path: '/agency/inbox',      Icon: MdInbox },
  { label: 'Online Interviews', path: '/agency/interviews', Icon: MdVideoCall },
  { label: 'Guarantee Letters', path: '/agency/generator',  Icon: MdCardMembership },
  { label: 'Slot Management',   path: '/agency/slots',      Icon: MdBarChart },
  { label: 'Application Logs',  path: '/agency/logs',       Icon: MdListAlt },
  { label: 'Messages',          path: '/agency/messages',   Icon: MdMessage },
]

const WORKFLOW = [
  'Receive', 'Review', 'Interview', 'Assessment',
  'Outcome', 'Approve + GL', 'Print → Upload', 'Redeem',
]

// ── Reusable section card ─────────────────────────────────────────────────

function SectionCard({ section, open, onToggle }) {
  const { icon, title, content, steps, items, note } = section
  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={onToggle}>
        <span className="text-lg flex-shrink-0" aria-hidden="true">{icon}</span>
        <span className="text-sm font-semibold text-gray-800 flex-1">{title}</span>
        {open
          ? <MdExpandLess size={20} className="text-gray-400 flex-shrink-0" />
          : <MdExpandMore size={20} className="text-gray-400 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-3 border-t border-gray-50 space-y-3">
          {content && (
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{content}</p>
          )}
          {steps && (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-600 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          )}
          {items && (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-xs font-semibold text-gray-800">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          )}
          {note && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
              <p className="text-xs text-blue-700 leading-relaxed">{note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AgencyGuide() {
  const navigate              = useNavigate()
  const [search, setSearch]   = useState('')
  const [openIds, setOpenIds] = useState(new Set())

  const toggle = (id) => setOpenIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter(s => {
      const haystack = [
        s.title,
        s.content ?? '',
        ...(s.steps ?? []),
        ...(s.items ?? []).flatMap(it => [it.label, it.desc]),
        s.note ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [search])

  const effectiveOpen = (id) => search.trim() ? true : openIds.has(id)

  const allFilteredIds = filtered.map(s => s.id)
  const allOpen  = allFilteredIds.length > 0 && allFilteredIds.every(id => openIds.has(id))
  const toggleAll = () => {
    if (allOpen || search.trim()) setOpenIds(new Set())
    else setOpenIds(new Set(allFilteredIds))
  }

  return (
    <Layout breadcrumb="User Guide">
      <div className="p-4 sm:p-6 max-w-3xl">

        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <MdMenuBook size={22} className="text-brand-500" />
              Agency User Guide
            </h1>
            <p className="page-sub">Step-by-step instructions for processing medical assistance applications.</p>
          </div>
          <span className="text-xs text-gray-400">Last updated {LAST_UPDATED}</span>
        </div>

        {/* ── Quick Links (one card) ── */}
        <div className="card p-5 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Links</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK_LINKS.map((link, i) => (
              <button key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-100 transition-colors text-left"
                onClick={() => navigate(link.path)}>
                <link.Icon size={16} className="flex-shrink-0 text-brand-500" />
                <span className="truncate">{link.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Workflow strip (one card) ── */}
        <div className="card p-5 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Workflow at a glance</p>
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {WORKFLOW.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="px-2 py-1 bg-brand-50 text-brand-600 rounded-lg font-medium">{s}</span>
                {i < WORKFLOW.length - 1 && <span className="text-gray-300">→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ── Search + controls (one card) ── */}
        <div className="card p-5 mb-5">
          <div className="flex gap-2 items-stretch">
            <div className="relative flex-1">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                className="input pl-9"
                placeholder="Search the guide…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              className="btn-secondary flex items-center gap-1.5 text-sm flex-shrink-0"
              onClick={toggleAll}
              disabled={!!search.trim()}
              title={search.trim() ? 'All sections expanded while searching' : ''}>
              {allOpen
                ? <><MdUnfoldLess size={16} /> Collapse all</>
                : <><MdUnfoldMore size={16} /> Expand all</>}
            </button>
          </div>
          {search.trim() && (
            <p className="text-xs text-gray-400 mt-2">
              {filtered.length} section{filtered.length === 1 ? '' : 's'} match — all expanded
            </p>
          )}
        </div>

        {/* ── Sections grouped (uniform cards) ── */}
        {GROUPS.map(group => {
          const groupSections = filtered.filter(s => s.group === group)
          if (groupSections.length === 0) return null
          return (
            <div key={group} className="mb-5">
              <div className="flex items-center gap-3 mb-2.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{group}</p>
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-gray-300">{groupSections.length}</span>
              </div>
              <div className="space-y-2">
                {groupSections.map(section => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    open={effectiveOpen(section.id)}
                    onToggle={() => toggle(section.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-400">No sections match "{search}". Try a different keyword.</p>
          </div>
        )}

        {/* ── Footer (same card style) ── */}
        <div className="card p-5 mt-5">
          <p className="text-xs text-gray-500 leading-relaxed">
            For technical issues with the portal, use <strong>Report a Problem</strong> in the user menu (top-right).
            For account access issues, contact your system administrator.
            For patient-related concerns, use the <strong>Messages</strong> feature to contact the patient directly.
          </p>
        </div>

      </div>
    </Layout>
  )
}
