import React from 'react'
import { MdWarningAmber } from 'react-icons/md'
import { captureError } from '../sentry'

// Top-level error boundary so an unhandled render error in one page doesn't
// blank out the entire app. Shows a friendly fallback and a Reload button.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log to console so the dev/operator can inspect the stack.
    console.error('Unhandled React error:', error, info)
    // Report to Sentry when error tracking is active (no-op otherwise).
    captureError(error, { componentStack: info?.componentStack })
    this.setState({ info })
  }

  handleReload = () => {
    // Reset state — works if the error was transient — then full reload as fallback.
    this.setState({ hasError: false, error: null, info: null })
    setTimeout(() => window.location.reload(), 50)
  }

  handleHome = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 mx-auto mb-4 flex items-center justify-center">
            <MdWarningAmber className="text-red-500" size={30} />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            The page hit an unexpected error and couldn't render. Your work has been preserved on the server — reload the page to try again.
          </p>
          {this.state.error?.message && (
            <details className="text-left mb-4">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                Technical details
              </summary>
              <pre className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <div className="flex gap-2 justify-center">
            <button onClick={this.handleHome}
              className="btn-secondary text-sm">
              Go to Home
            </button>
            <button onClick={this.handleReload}
              className="btn-primary text-sm">
              Reload Page
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            If this keeps happening, contact your system administrator and mention the technical details above.
          </p>
        </div>
      </div>
    )
  }
}
