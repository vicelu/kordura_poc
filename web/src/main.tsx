import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { isDemo } from './lib/api'
import { I18nProvider } from './lib/i18n'
import { ThemeProvider } from './lib/theme'
import { AlertsPage } from './pages/Alerts'
import { NodeDetail } from './pages/NodeDetail'
import { NotFound } from './pages/NotFound'
import { Overview } from './pages/Overview'
import './styles.css'

// GitHub Pages can't rewrite deep links to index.html, so the static demo keeps the route in the hash.
const Router = isDemo ? HashRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <Router>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Overview />} />
              <Route path="nodes/:id" element={<NodeDetail />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Router>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
