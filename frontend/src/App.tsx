import { lazy, Suspense } from "react"
import Particles from "./components/ui/Particles"
import { Navbar } from "./components/layout/Navbar"
import { UploadPage } from "./components/upload/UploadPage"
import { AnalysePage } from "./components/analyse/AnalysePage"
import { useHashRoute } from "./hooks/useHashRoutes"

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

function App() {
  const route = useHashRoute()

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
      <Navbar />
      <div className="relative z-10">
        <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
          {route === 'scan' && <ScanPage />}
          {route === 'surveys' && <SurveysLibraryPage />}
          {route === 'releves' && <SurveysPage />}
          {route === 'heatmap' && <HeatmapPage />}
          {route === 'settings' && <SettingsPage />}
        </Suspense>
        {route === 'upload' && <UploadPage />}
        {route === 'analyse' && <AnalysePage />}
      </div>
    </main>
  )
}

export default App
