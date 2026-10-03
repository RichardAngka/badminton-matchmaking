import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthGate } from './AuthGate'
import { SecretLanding } from './components/SecretLanding'
import './App.css'

const qc = new QueryClient()

// The public page owns the root; the matchmaking tool lives under /admin.
// Branching here instead of inside App keeps the public page clear of the auth
// gate and of App's session hooks — it reads one roster row and nothing else.
// ponytail: obscurity, not security; the gate inside AuthGate is the real one.
const isAdminApp = /^\/admin(\/|$)/.test(window.location.pathname)

// Anything outside the two public pages goes back to the front door rather than
// rendering the landing under a URL that does not exist. Done before render so
// there is no flash of the wrong page; /admin polices its own paths inside App.
const PUBLIC_PATHS = ['/', '/rank']
const here = window.location.pathname.replace(/\/+$/, '') || '/'
if (!isAdminApp && !PUBLIC_PATHS.includes(here)) window.location.replace('/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      {isAdminApp ? (
        /* basename keeps every route inside App written from the root, so the
           move cost one attribute rather than a rewrite of its tab table. */
        <BrowserRouter basename="/admin">
          <AuthGate><App /></AuthGate>
        </BrowserRouter>
      ) : <SecretLanding />}
    </QueryClientProvider>
  </StrictMode>,
)
