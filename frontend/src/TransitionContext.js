import { createContext } from "react"

export const TransitionContext = createContext({
  isTransitioning: false,
  setIsTransitioning: () => {},
})
