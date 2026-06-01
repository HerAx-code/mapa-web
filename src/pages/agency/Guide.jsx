import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  MdExpandMore, MdExpandLess, MdSearch, MdMenuBook,
  MdInbox, MdCardMembership, MdBarChart,
  MdListAlt, MdMessage, MdUnfoldMore, MdUnfoldLess,
} from 'react-icons/md'

const LAST_UPDATED = '2026-06-01'

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
      `Under the co-funding model, CRMC is the single intake gateway: patients submit ONE request for their full bill, ` +
      `CRMC verifies the documents, conducts the assessment interview, and fills the Unified Intake Sheet. CRMC then ` +
      `endorses the request to one or more agencies — each endorsement is a "slice" toward zero balance.\n\n` +
      `Your job as an agency coordinator is the funding decision only. You do NOT re-verify documents and you do NOT ` +
      `re-interview the patient. You read CRMC's assessment, decide whether to approve your slice (and for how much), ` +
      `and issue the Guarantee Letter that the named provider redeems with your agency.\n\n` +
      `MAPA does not move money — it records commitments. Actual settlement happens off-system between your ` +
      `agency and the provider.`,
  },
  {
    id: 'lifecycle',
    group: 'Orientation',
    icon: '🔄',
    title: 'Slice lifecycle',
    items: [
      { label: 'Endorsed',     desc: 'CRMC routed a slice of the patient\'s request to your agency. Waiting on the patient to confirm they want to proceed with your share.' },
      { label: 'For Funding',  desc: 'Patient confirmed. The slice is in your queue for a funding decision. CRMC has already verified docs and done the assessment — you decide approve / needs info / reject.' },
      { label: 'Needs Info',   desc: 'You requested clarification from the patient. They\'ve been notified; the slice waits in your queue with the amber chip until they respond.' },
      { label: 'Approved',     desc: 'You issued the approval with amount, purpose, and payable-to. GL status: Issued. Committed budget incremented. Patient notified.' },
      { label: 'Certificate',  desc: 'GL has been printed and confirmed. Upload the wet-signed scan so the patient can download it.' },
      { label: 'Rejected',     desc: 'Slice denied. Reason is sent to the patient. Other agency slices on the same request continue independently.' },
    ],
  },
  {
    id: 'glossary',
    group: 'Orientation',
    icon: '📖',
    title: 'Glossary — key terms',
    items: [
      { label: 'Patient Access Code',   desc: 'CRMC-YYYY-NNNNN code issued by Medical Social Services. Patients must enter it to register.' },
      { label: 'Request',               desc: 'The patient\'s top-level ask — one bill, one amount needed. Owned by CRMC after submission. The parent of one or more agency slices.' },
      { label: 'Application slice',     desc: 'Your agency\'s portion of a patient request. Created when CRMC endorses the request to you. Has its own lifecycle: endorsed → For Funding → approved (or needs_info / rejected).' },
      { label: 'Endorsement',           desc: 'CRMC\'s decision to route part of a verified request to your agency. Endorsement carries CRMC\'s assessment + verified documents — you do not re-do that work.' },
      { label: 'CRMC Assessment',       desc: 'The Unified Intake Sheet that CRMC fills during their single assessment interview. You see it read-only on each slice. Replaces the agency-side Case Assessment that existed before the redesign.' },
      { label: 'Means-Test Category',   desc: 'Manual classification recorded by CRMC: Indigent / Marginalized / Low Income / Above Threshold.' },
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
      'Open Application Inbox from the sidebar. The badge shows slices waiting on you (For Funding + Needs Info).',
      'Each row shows: patient name, slice ID, days since endorsement, document count, and a status chip.',
      'Click a row to open the four-tab detail view: Overview, CRMC Assessment (read-only), Documents (read-only), Timeline & Notes.',
      'The Message icon opens a chat with the patient. The blue action button reads "Review" or "View" depending on status.',
      'Summary cards at the top filter the list by status — click "For Funding" to focus your decision queue.',
    ],
    note: 'Days-since-endorsement turns amber at 3+ days and red at 7+ days. Tackle red rows first — patients are waiting on your funding decision after CRMC has already done their part.',
  },
  {
    id: 'review-endorsement',
    group: 'Daily Processing',
    icon: '▶️',
    title: 'Reviewing an endorsed slice',
    content:
      `When a slice reaches "For Funding," CRMC has already verified the patient's documents, conducted the assessment ` +
      `interview, and filled the Unified Intake Sheet. Your review is a funding judgment, not a re-verification.`,
    steps: [
      'Click a "For Funding" row → the application detail opens on the Overview tab.',
      'Read the CRMC Assessment tab to see household composition, income, expenses, diagnosis, social case narrative, and CRMC\'s recommendation. This is the same Unified Intake Sheet CRMC used; you cannot edit it.',
      'Open the Documents tab to view the patient\'s attached files (also read-only on your side).',
      'Check the request context — your slice is part of a larger ask; the page shows what other agencies have already approved toward zero balance.',
      'Choose one of three actions: Approve & Issue GL, Request More Info, or Reject.',
    ],
    note: 'If something in CRMC\'s assessment looks wrong or incomplete, use Request More Info (sends a question to the patient) or Reject with a clear reason — do not edit CRMC\'s sheet.',
  },
  {
    id: 'needs-info',
    group: 'Daily Processing',
    icon: '❔',
    title: 'Requesting more info from the patient',
    content:
      `If CRMC\'s assessment is missing something your agency specifically needs — proof of address for a province-locked ` +
      `program, a more recent billing statement, etc. — you can pause the slice and request it from the patient ` +
      `directly without rejecting.`,
    steps: [
      'In the application detail, click Request More Info.',
      'Write a specific question or list. The patient will see exactly this text.',
      'Click Send. Slice status moves to Needs Info; the patient is notified with your message.',
      'When the patient responds, the slice returns to your queue with the original For Funding chip.',
      'Click Resume Review to continue, or Update Request to ask a follow-up.',
    ],
    note: 'Use Request More Info sparingly — CRMC already did the standard verification. This is for agency-specific extras.',
  },

  // ── Approval and GL ────────────────────────────────────────────
  {
    id: 'approve',
    group: 'Approval & Guarantee Letter',
    icon: '✅',
    title: 'Approving and issuing a Guarantee Letter',
    content:
      `The Approve & Issue GL action captures three pieces of information: the guaranteed amount, the purpose, ` +
      `and the provider (Payable To). The slice moves to Approved, your agency's committed budget increases ` +
      `by the approved amount, and the patient is notified. There is no separate "complete the assessment first" ` +
      `prerequisite under the co-funding redesign — CRMC has already completed that on the parent request.`,
    steps: [
      'Open the slice → click Approve & Issue GL (available once status is "For Funding").',
      'Review the budget remaining banner — your approval cannot exceed this amount.',
      'If a cooldown warning appears (a recent approval for the same patient by any agency), decide whether to proceed.',
      'Enter the approved amount in pesos. Validation blocks amounts exceeding the remaining budget OR the slice\'s outstanding balance on the parent request.',
      'Pick one or more purposes from your agency\'s assistance types.',
      'Enter the provider name (Payable To) — e.g. "CRMC Billing Department", "Mercury Drug Cotabato".',
      'Click Approve & Issue GL. The committed budget increments and the patient is notified.',
    ],
    note: 'Approve only what your agency can actually fund. The budget enforcement is real — exceeding it is blocked. You can approve LESS than the slice asks for; the remaining balance stays open for other agencies to fund.',
  },
  {
    id: 'reject',
    group: 'Approval & Guarantee Letter',
    icon: '⛔',
    title: 'Rejecting a slice',
    steps: [
      'Open the slice → click Reject in the action footer.',
      'Pick a template reason (Income ineligible for our program, Provider not in our network, etc.) or write a custom reason.',
      'Click Confirm Reject. The patient is notified with the exact reason.',
      'If the slice was endorsed today, the slot is automatically restored.',
    ],
    note: 'Be specific so the patient knows whether to appeal, ask CRMC for re-endorsement to another agency, or correct something for next time. Rejecting one slice does not close the parent request — other agency slices continue independently.',
  },
  {
    id: 'print-upload',
    group: 'Approval & Guarantee Letter',
    icon: '🖨️',
    title: 'Printing and uploading the Guarantee Letter',
    content:
      `After approval, the Guarantee Letter has its own dedicated viewer page. From there you can print to a physical printer for wet-signing, or save as a true vector PDF using the browser's "Save as PDF" option.`,
    items: [
      { label: 'Open GL Viewer', desc: 'From the slice detail (or the Guarantee Letters page), click "Open GL Viewer" to see the full GL rendered exactly as it will print.' },
      { label: 'Print',          desc: 'On the viewer page, click Print. The browser print dialog opens — pick your physical printer for wet-signing on paper.' },
      { label: 'Save as PDF',    desc: 'On the viewer page, click Save as PDF. The same print dialog opens — pick "Save as PDF" as the destination to get a real vector PDF (selectable text, crisp graphics) on disk.' },
      { label: 'Upload Signed Scan', desc: 'After wet-signing the printed copy, scan or photograph it (JPG/PNG, ≤4 MB) and upload via the "Upload Signed Scan" button. The patient can then download the signed copy from their Track Status page.' },
    ],
    steps: [
      'Open the slice → Guarantee Letter section → click Open GL Viewer.',
      'On the viewer, click Print (for paper) or Save as PDF (then pick "Save as PDF" in the print dialog).',
      'Return to the slice and confirm "Yes, mark as Issued" only after the print/save actually succeeds — that flips the slice to Guarantee Letter Issued.',
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
      { label: 'Redeemed', desc: 'The named provider billed back for the amount. In the slice detail, click Mark GL Redeemed. Budget moves from committed → disbursed.' },
      { label: 'Expired',  desc: '30 days passed without redemption. The Inbox row and slice detail show "Expired (action needed)". Click Mark GL Expired to release the committed budget back to your allocation.' },
      { label: 'Reversed', desc: 'You made a mistake (wrong amount, wrong provider). Click Reverse Approval. The slice returns to For Funding, the committed budget is released, the patient is notified.' },
    ],
    note: 'Always close the loop. Unredeemed GLs that never get marked expired will lock your committed budget indefinitely.',
  },

  // ── Operations ─────────────────────────────────────────────────
  {
    id: 'slots',
    group: 'Operations',
    icon: '🎫',
    title: 'Daily slot management',
    content:
      `Slots represent your agency's daily processing capacity. Under the co-funding redesign, slots are consumed when ` +
      `CRMC endorses a slice to your agency (not when a patient submits an application). If your slots are full for ` +
      `the day, CRMC's endorse modal warns the staff member and they can choose a different agency or hold the request ` +
      `for tomorrow.`,
    steps: [
      'Open Slot Management from the sidebar.',
      'Default Slot Capacity is your daily cap (max 100). Edit to change it — the new default takes effect from the next reset.',
      'Today\'s Slots shows current remaining/total. The Usage chip turns amber/red as you near the cap.',
      'Slots reset to default at the start of each new day. The reset fires when the first coordinator opens the workspace.',
      'For walk-ins or corrections that bypassed the endorsement flow, use Manual Adjustment. Add a reason — every change is logged in the audit trail.',
      'Recent Adjustments shows the last 10 changes with author and time.',
    ],
    note: 'Reject-today restores the slot automatically. Manual deduct is for walk-ins handled in person outside the MAPA endorsement flow.',
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
      'Or open the slice detail → click Message Patient in the footer → type → Send.',
      'All conversations are listed under Messages in the sidebar.',
      'The patient receives an in-portal notification and can reply.',
    ],
    note: 'For clarifications that the patient needs to formally respond to with documents, use Request More Info on the slice instead — it pauses the slice and surfaces the prompt in their queue.',
  },
  {
    id: 'notes',
    group: 'Operations',
    icon: '📝',
    title: 'Adding case notes',
    content:
      `Case notes are an append-only log on the slice. Use them for your own ongoing observations: ` +
      `"Called patient on 5/19, voicemail" or "Provider confirmed receipt of GL". They are NOT how you record an ` +
      `assessment — CRMC owns the Unified Intake Sheet under the redesign.`,
    steps: [
      'Open the slice → Timeline & Notes tab.',
      'Type your note in the textarea (up to 500 characters).',
      'Click Add. The note is permanent (no edit/delete).',
      'Notes are visible to your agency\'s coordinators and to CRMC admins for audit.',
    ],
  },
  {
    id: 'logs',
    group: 'Operations',
    icon: '📑',
    title: 'Application Logs and history',
    steps: [
      'Open Application Logs from the sidebar.',
      'All slices — current and past — are listed.',
      'Filter by status tab (Endorsed / For Funding / Needs Info / Approved / Rejected / Certificate) or search by name/contact/slice ID.',
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
      { label: 'The Approve button is disabled',     desc: 'Slice is not yet at "For Funding" — the patient may not have confirmed they want to proceed with your share, or CRMC hasn\'t finalized the endorsement. Check the status chip on the slice.' },
      { label: 'CRMC\'s assessment looks incomplete', desc: 'You cannot edit it from your side. Use Request More Info to ask the patient directly, or message CRMC via the admin Messages flow if the gap is on CRMC\'s side.' },
      { label: 'My approval was blocked',            desc: 'Either you tried to approve more than the agency\'s remaining budget, OR more than the slice\'s outstanding balance on the parent request. Lower the amount or ask the admin to increase the allocation.' },
      { label: 'I see "GL Expired (action needed)"', desc: 'A GL passed its 30-day validity window. Open the slice and click Mark GL Expired to release the committed budget.' },
      { label: 'A patient says they didn\'t get the notification', desc: 'Check Messages and send a direct message. The patient may not have logged in to the portal yet.' },
      { label: 'I approved by mistake',              desc: 'Open the slice → click Reverse Approval. The committed budget is released and the slice returns to For Funding.' },
      { label: 'The print window cancelled',         desc: 'Answer "Not yet" on the confirmation prompt. The slice stays at Approved so you can retry.' },
      { label: 'No budget allocated message',        desc: 'Ask your Agency Administrator to set a budget on /agency/allocation, or the CRMC system administrator if your agency has none on file.' },
      { label: 'Why don\'t I schedule interviews anymore', desc: 'Under the co-funding redesign, CRMC conducts a single assessment interview on the parent request and shares the result with all endorsed agencies. Your agency makes a funding decision based on that — no per-agency interview.' },
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
  { label: 'Guarantee Letters', path: '/agency/generator',  Icon: MdCardMembership },
  { label: 'Slot Management',   path: '/agency/slots',      Icon: MdBarChart },
  { label: 'Application Logs',  path: '/agency/logs',       Icon: MdListAlt },
  { label: 'Messages',          path: '/agency/messages',   Icon: MdMessage },
]

const WORKFLOW = [
  'Endorsed', 'Patient Proceeds', 'For Funding',
  'Approve + GL', 'Print → Upload', 'Redeem',
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
            <p className="page-sub">Step-by-step instructions for funding endorsed application slices under the CRMC-gateway model.</p>
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
