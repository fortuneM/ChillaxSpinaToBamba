import React, { useEffect, useRef, useState, useMemo } from 'react';
import { sounds } from '../utils/sound';

// High-contrast arcade neon palette for wheel segments
const SEGMENT_COLORS = [
  '#06b6d4', // Vibrant Cyan
  '#8b5cf6', // Electric Violet
  '#ec4899', // Hot Pink
  '#f59e0b', // Radiant Amber
  '#10b981', // Emerald Green
  '#3b82f6', // Arcade Blue
  '#a855f7', // Vivid Purple
  '#ef4444', // Neon Coral
  '#14b8a6', // Deep Teal
  '#eab308'  // Goldenrod
];

export function ArcadeWheel({
  min = 1,
  max = 20,
  claimedNumbers = [],
  winningNumber = null,
  isSpinning = false,
  spinDurationMs = 5000,
  onSpinComplete = () => {}
}) {
  const [rotation, setRotation] = useState(0);
  const currentRotationRef = useRef(0);
  const isCurrentlySpinningRef = useRef(false);

  const totalSegments = Math.max(1, max - min + 1);
  const segmentAngle = 360 / totalSegments;

  // Wheel dimensions
  const wheelSize = 520;
  const radius = wheelSize / 2;
  const outerRimRadius = radius - 8;
  const innerTrackRadius = outerRimRadius - 22;

  // Generate segments data with perfect alignment
  // Slice k center is at angle (k * segmentAngle) clockwise from top (12 o'clock)
  const segments = useMemo(() => {
    const list = [];
    for (let i = 0; i < totalSegments; i++) {
      const num = min + i;
      const isClaimed = claimedNumbers.includes(num);
      const isWinner = winningNumber === num;
      const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
      list.push({
        index: i,
        number: num,
        isClaimed,
        isWinner,
        color
      });
    }
    return list;
  }, [min, totalSegments, claimedNumbers, winningNumber]);

  // Handle spin trigger
  useEffect(() => {
    if (isSpinning && winningNumber !== null && !isCurrentlySpinningRef.current) {
      isCurrentlySpinningRef.current = true;
      sounds.startSpinSounds(spinDurationMs);

      // Slice k is centered at angle (k * segmentAngle) clockwise from 12 o'clock
      const winningIndex = winningNumber - min;
      const targetSliceCenterAngle = winningIndex * segmentAngle;

      // To bring targetSliceCenterAngle to top (0 deg / 12 o'clock),
      // we need: (finalRotation + targetSliceCenterAngle) % 360 === 0
      // So finalRotation mod 360 = (360 - (targetSliceCenterAngle % 360)) % 360
      const currentNorm = currentRotationRef.current % 360;
      const desiredNorm = (360 - (targetSliceCenterAngle % 360)) % 360;

      let delta = desiredNorm - currentNorm;
      if (delta <= 0) {
        delta += 360;
      }

      // 12 full 360-degree spins in 5 seconds for fast, high-velocity arcade action
      const fullRotations = 12 * 360;
      const finalRotation = currentRotationRef.current + fullRotations + delta;

      currentRotationRef.current = finalRotation;
      setRotation(finalRotation);

      const timer = setTimeout(() => {
        isCurrentlySpinningRef.current = false;
        sounds.stopSpinSounds();
        sounds.playFanfare();
        onSpinComplete();
      }, spinDurationMs);

      return () => clearTimeout(timer);
    }
  }, [isSpinning, winningNumber, min, segmentAngle, spinDurationMs, onSpinComplete]);

  // Create SVG slice path centered on slice k
  // In standard SVG math (0 deg = 3 o'clock):
  // 12 o'clock is -90 deg.
  // Center of slice k is at -90 + (k * segmentAngle) deg.
  // Slice spans from center - segmentAngle/2 to center + segmentAngle/2!
  const createSlicePath = (index, r) => {
    const centerDeg = -90 + index * segmentAngle;
    const startAngle = (centerDeg - segmentAngle / 2) * (Math.PI / 180);
    const endAngle = (centerDeg + segmentAngle / 2) * (Math.PI / 180);

    const x1 = radius + r * Math.cos(startAngle);
    const y1 = radius + r * Math.sin(startAngle);
    const x2 = radius + r * Math.cos(endAngle);
    const y2 = radius + r * Math.sin(endAngle);

    const largeArc = segmentAngle > 180 ? 1 : 0;
    return `M ${radius} ${radius} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  return (
    <div className="arcade-wheel-container">
      {/* Top Fixed Pointer perfectly aligned with 12 o'clock */}
      <div className={`wheel-pointer ${isSpinning ? 'pointer-wiggling' : ''}`}>
        <svg viewBox="0 0 44 52" className="pointer-svg">
          <defs>
            <filter id="pointer-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#f59e0b" floodOpacity="0.9" />
            </filter>
            <linearGradient id="pointer-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>
          {/* Sharp pointer indicator */}
          <polygon
            points="22,48 4,8 40,8"
            fill="url(#pointer-gold-grad)"
            stroke="#ffffff"
            strokeWidth="2.5"
            filter="url(#pointer-shadow)"
          />
          <circle cx="22" cy="16" r="5" fill="#070d1e" stroke="#fef08a" strokeWidth="2" />
        </svg>
      </div>

      {/* Rotating Wheel Group */}
      <div
        className="wheel-rotating-wrapper"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: isSpinning
            ? `transform ${spinDurationMs}ms cubic-bezier(0.08, 0.88, 0.18, 1)`
            : 'none'
        }}
      >
        <svg
          viewBox={`0 0 ${wheelSize} ${wheelSize}`}
          className="wheel-svg"
        >
          <defs>
            <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <radialGradient id="rim-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="86%" stopColor="#0f172a" />
              <stop offset="93%" stopColor="#1e293b" />
              <stop offset="97%" stopColor="#00f2fe" />
              <stop offset="100%" stopColor="#070d1e" />
            </radialGradient>
          </defs>

          {/* Outer Bezel Rim */}
          <circle
            cx={radius}
            cy={radius}
            r={outerRimRadius}
            fill="url(#rim-gradient)"
            stroke="#00f2fe"
            strokeWidth="3.5"
            filter="url(#neon-glow)"
          />

          {/* Wheel Slices */}
          <g>
            {segments.map((seg) => {
              const pathD = createSlicePath(seg.index, innerTrackRadius);

              // Position text along the center ray of slice
              const centerDeg = -90 + seg.index * segmentAngle;
              const rad = centerDeg * (Math.PI / 180);
              const textRadius = innerTrackRadius * 0.72;
              const textX = radius + textRadius * Math.cos(rad);
              const textY = radius + textRadius * Math.sin(rad);

              // Upright legibility calculation:
              // Natural spoke angle is centerDeg + 90
              let textRot = centerDeg + 90;
              const norm = ((textRot % 360) + 360) % 360;
              // If in the bottom hemisphere, flip by 180 so it's always right-side up!
              if (norm > 90 && norm < 270) {
                textRot += 180;
              }

              return (
                <g key={seg.number} className="wheel-slice-item">
                  {/* Slice Wedge */}
                  <path
                    d={pathD}
                    fill={seg.color}
                    stroke="#070d1e"
                    strokeWidth="2"
                    opacity={seg.isClaimed ? 1 : 0.88}
                  />

                  {/* Golden Claim Glow for active player claims */}
                  {seg.isClaimed && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#fef08a"
                      strokeWidth="4"
                      strokeDasharray="6 3"
                      opacity="0.95"
                    />
                  )}

                  {/* Number Label */}
                  <g transform={`translate(${textX}, ${textY}) rotate(${textRot})`}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontWeight="900"
                      fontSize={totalSegments > 20 ? '22' : '28'}
                      fontFamily="Orbitron, sans-serif"
                      stroke="#070d1e"
                      strokeWidth="4"
                      paintOrder="stroke fill"
                      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))' }}
                    >
                      {seg.number}
                    </text>
                    {seg.isClaimed && (
                      <circle
                        cx="0"
                        cy="16"
                        r="3.5"
                        fill="#fef08a"
                        stroke="#070d1e"
                        strokeWidth="1.5"
                      />
                    )}
                  </g>
                </g>
              );
            })}
          </g>

          {/* Pegs/Pins precisely at boundaries between slices */}
          {Array.from({ length: totalSegments }).map((_, i) => {
            const pegDeg = -90 + i * segmentAngle - segmentAngle / 2;
            const pegRad = pegDeg * (Math.PI / 180);
            const pegX = radius + (innerTrackRadius + 7) * Math.cos(pegRad);
            const pegY = radius + (innerTrackRadius + 7) * Math.sin(pegRad);
            return (
              <circle
                key={i}
                cx={pegX}
                cy={pegY}
                r="4"
                fill="#ffffff"
                stroke="#0284c7"
                strokeWidth="1.5"
                style={{ filter: 'drop-shadow(0 0 4px #38bdf8)' }}
              />
            );
          })}
        </svg>
      </div>

      {/* Stationary Center Hub - Stays level and upright while wheel rotates! */}
      <div className="wheel-stationary-hub">
        <div className="hub-inner-glow">
          <span className="hub-brand-text">CHILLAX</span>
        </div>
      </div>

      {/* Ambient background glow ring */}
      <div className={`wheel-ambient-glow ${isSpinning ? 'spinning-ambient' : ''}`} />
    </div>
  );
}
