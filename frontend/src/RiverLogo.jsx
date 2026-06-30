export default function RiverLogo({ height = 26 }) {
  return (
    <svg
      width={height * 1.6}
      height={height}
      viewBox="0 0 800 500"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
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
  )
}
