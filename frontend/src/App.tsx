import { lazy, Suspense, useLayoutEffect } from "react"
import Particles from "./components/ui/Particles"
import { Navbar } from "./components/layout/Navbar"
import { UploadPage } from "./components/upload/UploadPage"
import { useHashRoute } from "./hooks/useHashRoutes"
import { startApiSync } from "./lib/apiSync"

const ScanPage = lazy(() =>
  import("./components/scan/ScanPage").then(({ ScanPage }) => ({ default: ScanPage }))
)
const SurveysPage = lazy(() =>
  import("./components/surveys/SurveysPage").then(({ SurveysPage }) => ({ default: SurveysPage }))
)
const SurveysLibraryPage = lazy(() =>
  import("./components/surveys/SurveysLibraryPage").then(({ SurveysLibraryPage }) => ({ default: SurveysLibraryPage }))
)
const HeatmapPage = lazy(() =>
  import("./components/heatmap/HeatmapPage").then(({ HeatmapPage }) => ({ default: HeatmapPage }))
)
const SettingsPage = lazy(() =>
  import("./components/settings/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage }))
)
const ChannelAnalyzerPage = lazy(() =>
  import("./components/channels/ChannelAnalyzerPage").then(({ ChannelAnalyzerPage }) => ({ default: ChannelAnalyzerPage }))
)
const AccountPage = lazy(() =>
  import("./components/account/AccountPage").then(({ AccountPage }) => ({ default: AccountPage }))
)
function App() {
  const route = useHashRoute()
  useLayoutEffect(startApiSync, [])

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#070b12]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <Particles
          particleColors={["#ffffff"]}
          particleCount={200}
          particleSpread={10}
          speed={0.1}
          particleBaseSize={100}
          moveParticlesOnHover
          alphaParticles={false}
          disableRotation={false}
          pixelRatio={1}
        />
      </div>
      <div className="relative z-10">
      <Navbar />
      <Suspense fallback={<div role="status" className="mx-auto max-w-[1320px] px-4 py-12 text-sm text-text-dim">Chargement de l’écran…</div>}>
        {route === 'scan' && <ScanPage />}
        {route === 'surveys' && <SurveysLibraryPage />}
        {route === 'releves' && <SurveysPage />}
        {route === 'heatmap' && <HeatmapPage />}
        {route === 'channels' && <ChannelAnalyzerPage />}
        {route === 'settings' && <SettingsPage />}
        {route === 'account' && <AccountPage />}
      </Suspense>
      {route === 'upload' && <UploadPage />}
      </div>
    </main>
  )
}

export default App
