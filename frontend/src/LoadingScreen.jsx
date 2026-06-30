export default function LoadingScreen({ show }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#0F0F0F",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: show ? 1 : 0,
        pointerEvents: show ? "auto" : "none",
        transition: "opacity 0.35s ease",
      }}
    >
      <style>{`
        @keyframes letheWave {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-12px); }
        }
        .lethe-wave-svg path:nth-child(1) {
          animation: letheWave 1.8s ease-in-out infinite;
        }
        .lethe-wave-svg path:nth-child(2) {
          animation: letheWave 1.8s ease-in-out 0.15s infinite;
        }
        .lethe-wave-svg path:nth-child(3) {
          animation: letheWave 1.8s ease-in-out 0.30s infinite;
        }
      `}</style>

      <svg
        className="lethe-wave-svg"
        width="200"
        viewBox="0 0 800 500"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M160 210 C240 170, 320 250, 400 210 S560 170, 640 210"
          stroke="#4ECDC4"
          strokeWidth="22"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M160 280 C240 240, 320 320, 400 280 S560 240, 640 280"
          stroke="#4ECDC4"
          strokeWidth="22"
          strokeLinecap="round"
          fill="none"
          opacity="0.62"
        />
        <path
          d="M200 350 C265 315, 330 380, 400 350 S530 315, 590 350"
          stroke="#4ECDC4"
          strokeWidth="22"
          strokeLinecap="round"
          fill="none"
          opacity="0.32"
        />
      </svg>

      <span
        style={{
          color: "#4ECDC4",
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "0.1em",
          marginTop: 20,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        Lethe
      </span>
    </div>
  )
}
