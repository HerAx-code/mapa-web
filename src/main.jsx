import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import AppToaster from './components/AppToaster.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initSentry } from './sentry'
import './index.css'
import './i18n'   // initialize i18next

// Error tracking — no-op unless VITE_SENTRY_DSN is configured. Fire-and-
// forget: it lazy-loads the SDK and installs global error handlers.
initSentry()

// PWA service worker — `autoUpdate` mode means a new deploy is picked up
// silently on the next navigation. No "reload to update?" prompt; the
// trade-off is documented in vite.config.js. Patients on the pilot are
// not technical users and confirming a reload would just confuse them.
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter future={{
        // Opt in to the v7 behaviours early -- silences the two future-flag
        // warnings that appear in the browser console and prepares the app
        // for the eventual react-router-dom v7 upgrade without surprise.
        //   v7_startTransition  : state updates wrapped in React.startTransition
        //   v7_relativeSplatPath: relative resolution within splat routes
        // See https://reactrouter.com/v6/upgrading/future
        v7_startTransition:   true,
        v7_relativeSplatPath: true,
      }}>
        <App />
        <AppToaster />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
