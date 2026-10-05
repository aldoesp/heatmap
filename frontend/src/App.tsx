import { lazy, Suspense } from "react"
import Particles from "./components/ui/Particles"
import { Navbar } from "./components/layout/Navbar"
import { UploadPage } from "./components/upload/UploadPage"
import { useHashRoute } from "./hooks/useHashRoutes"

const ScanPage = lazy(() =>
  import("./components/scan/ScanPage").then(({ ScanPage }) => ({ default: ScanPage }))
)

function App() {
  const route = useHashRoute()

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#070b12]">
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
        </Suspense>
        {route === 'upload' && <UploadPage />}
      </div>
    </main>
  )
}

export default App
