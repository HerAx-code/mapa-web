import { useState } from 'react'
import { MdClose, MdEdit, MdSend } from 'react-icons/md'

const MOCK_CONVERSATIONS = [
  {
    id: 1, agency: 'Malasakit Center', agencyId: 'malasakit', initials: 'MC', color: 'bg-brand-500',
    lastMessage: 'Your application has been reviewed. Please prepare for your interview.', time: '2h ago', unread: 1,
    messages: [
      { from: 'agency', text: 'Hello! We have received your application.', time: '2 days ago' },
      { from: 'patient', text: 'Thank you. When will it be reviewed?', time: '2 days ago' },
      { from: 'agency', text: 'Your application has been reviewed. Please prepare for your interview.', time: '2h ago' },
    ]
  },
  {
    id: 2, agency: 'DSWD AICS', agencyId: 'dswd', initials: 'DS', color: 'bg-blue-600',
    lastMessage: 'Please submit your updated Barangay Certificate.', time: '1 day ago', unread: 0,
    messages: [
      { from: 'patient', text: 'Good morning. I would like to inquire about the requirements.', time: '2 days ago' },
      { from: 'agency', text: 'Please submit your updated Barangay Certificate.', time: '1 day ago' },
    ]
  },
]

export default function MessagesPanel({ onClose }) {
  const [active, setActive] = useState(null)
  const [newMsg, setNewMsg] = useState('')

  const conv = active ? MOCK_CONVERSATIONS.find(c => c.id === active) : null

  return (
    <div className="absolute right-0 top-11 w-full max-w-sm sm:w-[420px] bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden flex flex-col max-h-[calc(100vh-90px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {active && (
            <button onClick={() => setActive(null)} className="text-gray-400 hover:text-gray-600 mr-1">
              ←
            </button>
          )}
          <h3 className="text-sm font-semibold text-gray-800">
            {active ? conv?.agency : 'Messages'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!active && (
            <button className="flex items-center gap-1 text-xs bg-brand-500 text-white px-3 py-1.5 rounded-lg hover:bg-brand-600">
              <MdEdit size={13} />
              Compose
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <MdClose size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      {!active ? (
        /* Conversation list */
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {MOCK_CONVERSATIONS.map(c => (
            <button
              key={c.id}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
              onClick={() => setActive(c.id)}
            >
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${c.color} text-white text-xs font-semibold flex items-center justify-center`}>
                {c.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{c.agency}</span>
                  <span className="text-xs text-gray-400">{c.time}</span>
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{c.lastMessage}</p>
              </div>
              {c.unread > 0 && (
                <span className="flex-shrink-0 w-4 h-4 bg-brand-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                  {c.unread}
                </span>
              )}
            </button>
          ))}
          <div className="px-4 py-2.5 text-center">
            <span className="text-xs text-gray-400">Showing last 50 messages</span>
          </div>
        </div>
      ) : (
        /* Conversation thread */
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {conv?.messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === 'patient' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${
                  msg.from === 'patient'
                    ? 'bg-brand-500 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-700 rounded-bl-sm'
                }`}>
                  {msg.text}
                  <p className={`text-xs mt-1 ${msg.from === 'patient' ? 'text-brand-100' : 'text-gray-400'}`}>
                    {msg.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {/* Input */}
          <div className="px-3 py-3 border-t border-gray-100 flex items-center gap-2">
            <input
              type="text"
              className="input flex-1 text-sm"
              placeholder="Type a message..."
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setNewMsg('')}
            />
            <button
              className="flex-shrink-0 w-9 h-9 bg-brand-500 text-white rounded-lg flex items-center justify-center hover:bg-brand-600"
              onClick={() => setNewMsg('')}
            >
              <MdSend size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
