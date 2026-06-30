import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { TransitionContext } from "./TransitionContext.js"
import "./index.css"
import App from "./App.jsx"
import LandingPage from "./LandingPage.jsx"
import LoadingScreen from "./LoadingScreen.jsx"

function AppShell() {
  // Starts true so the loading screen covers the initial paint on every route.
  // Each page is responsible for calling setIsTransitioning(false) when ready.
  const [isTransitioning, setIsTransitioning] = useState(true)

  return (
    <TransitionContext.Provider value={{ isTransitioning, setIsTransitioning }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/chat" element={<App />} />
      </Routes>
      <LoadingScreen show={isTransitioning} />
    </TransitionContext.Provider>
  )
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  </StrictMode>
)
