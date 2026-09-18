import { useEffect, useState } from 'react'
import { Toaster, useToasterStore, toast } from 'react-hot-toast'

// App-wide toast host. Split out of main.jsx so it can be a component with
// hooks — it needs to (a) place toasts sensibly per breakpoint, (b) clear the
// safe-area / bottom tab bar, and (c) cap how many stack at once.
//
// Why: on a phone the previous bottom-right placement let a burst of toasts
// climb up the right edge and overlap the form + bottom tab bar. On mobile we
// use top-center (out of the thumb zone and clear of the tab bar); desktop
// keeps bottom-right. We also hard-cap concurrent toasts so a burst — or a
// preview browser that pauses react-hot-toast's dismiss timers while the tab
// reads as hidden — can't wall off the screen.
const MAX_VISIBLE = 3

export default function AppToaster() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Cap concurrent toasts: dismiss the oldest visible ones beyond MAX_VISIBLE.
  const { toasts } = useToasterStore()
  useEffect(() => {
    toasts
      .filter(t => t.visible)
      .filter((_, i) => i >= MAX_VISIBLE)
      .forEach(t => toast.dismiss(t.id))
  }, [toasts])

  const position = isDesktop ? 'bottom-right' : 'top-center'
  const containerStyle = isDesktop
    ? { bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }
    : { top: 'calc(env(safe-area-inset-top) + 12px)' }

  return (
    <Toaster
      position={position}
      gutter={8}
      containerStyle={containerStyle}
      toastOptions={{
        duration: 4000,
        // Errors linger a bit longer than confirmations.
        error: { duration: 6000 },
        style: {
          background: '#1f2937',
          color: '#f9fafb',
          borderRadius: '10px',
          fontSize: '13px',
          maxWidth: '92vw',
        },
      }}
    />
  )
}
