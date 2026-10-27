import React, { useEffect, useRef, useState, useMemo } from 'react';
import { sounds } from '../utils/sound';

// Curated high-contrast arcade color palette for segments
const SEGMENT_COLORS = [
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ef4444', // Red-orange
  '#14b8a6', // Teal
  '#eab308'  // Golden yellow
];

export function ArcadeWheel({
  min = 1,
  max = 20,
  claimedNumbers = [],
  winningNumber = null,
  isSpinning = false,
  spinDurationMs = 6500,
  onSpinComplete = () => {}
}) {
  const [rotation, setRotation] = useState(0);
  const currentRotationRef = useRef(0);
  const isCurrentlySpinningRef = useRef(false);

  const totalSegments = Math.max(1, max - min + 1);
  const segmentAngle = 360 / totalSegments;

  // Generate segments data
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
  }, [min, max, totalSegments, claimedNumbers, winningNumber]);

  // Handle spin trigger
  useEffect(() => {
    if (isSpinning && winningNumber !== null && !isCurrentlySpinningRef.current) {
      isCurrentlySpinningRef.current = true;
      sounds.startSpinSounds(spinDurationMs);

      // Target slice calculation:
      // Slice k center is at (k + 0.5) * segmentAngle from top (0 deg)
      const winningIndex = winningNumber - min;
      const targetCenterAngle = (winningIndex + 0.5) * segmentAngle;

      // Current normalized angle mod 360
      const currentNorm = currentRotationRef.current % 360;
      // We want: (currentRotation + totalDelta) % 360 = (360 - targetCenterAngle) % 360
      const desiredAngleNorm = (360 - (targetCenterAngle % 360)) % 360;

      let delta = desiredAngleNorm - currentNorm;
      if (delta <= 0) {
        delta += 360;
      }

      // Add 6 full 360-degree spins for maximum suspense
      const fullRotations = 6 * 360;
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

  // Helper to create SVG arc slice path
  const createSlicePath = (index, total, radius) => {
    const startAngle = (index * segmentAngle - 90) * (Math.PI / 180);
    const endAngle = ((index + 1) * segmentAngle - 90) * (Math.PI / 180);

    const x1 = radius + radius * Math.cos(startAngle);
    const y1 = radius + radius * Math.sin(startAngle);
    const x2 = radius + radius * Math.cos(endAngle);
    const y2 = radius + radius * Math.sin(endAngle);

    const largeArc = segmentAngle > 180 ? 1 : 0;
    return `M ${radius} ${radius} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  const wheelSize = 580;
  const radius = wheelSize / 2;
  const outerRimRadius = radius - 8;
  const innerTrackRadius = outerRimRadius - 24;

  return (
    <div className="arcade-wheel-container">
      {/* Top Fixed Pointer with Neon Glow */}
      <div className={`wheel-pointer ${isSpinning ? 'pointer-wiggling' : ''}`}>
        <svg width="48" height="58" viewBox="0 0 48 58">
          <defs>
            <filter id="pointer-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#f59e0b" floodOpacity="0.8" />
            </filter>
            <linearGradient id="pointer-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
          </defs>
          <polygon
            points="24,54 6,10 42,10"
            fill="url(#pointer-grad)"
            stroke="#ffffff"
            strokeWidth="3"
            filter="url(#pointer-glow)"
          />
          <circle cx="24" cy="18" r="6" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
        </svg>
      </div>

      {/* Rotating Wheel Wrapper */}
      <div
        className="wheel-rotating-wrapper"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: isSpinning
            ? `transform ${spinDurationMs}ms cubic-bezier(0.12, 0.82, 0.22, 1)`
            : 'none'
        }}
      >
        <svg
          width={wheelSize}
          height={wheelSize}
          viewBox={`0 0 ${wheelSize} ${wheelSize}`}
          className="wheel-svg"
        >
          <defs>
            {/* Glowing outer bezel filter */}
            <filter id="neon-rim-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Gradient for wheel outer ring */}
            <radialGradient id="rim-metal" cx="50%" cy="50%" r="50%">
              <stop offset="85%" stopColor="#1e293b" />
              <stop offset="92%" stopColor="#334155" />
              <stop offset="96%" stopColor="#00f2fe" />
              <stop offset="100%" stopColor="#0f172a" />
            </radialGradient>
          </defs>

          {/* Outer Bezel */}
          <circle
            cx={radius}
            cy={radius}
            r={outerRimRadius}
            fill="url(#rim-metal)"
            stroke="#00f2fe"
            strokeWidth="4"
            filter="url(#neon-rim-glow)"
          />

          {/* Slices */}
          <g>
            {segments.map((seg) => {
              const pathD = createSlicePath(seg.index, totalSegments, innerTrackRadius);
              const angleDeg = seg.index * segmentAngle + segmentAngle / 2;
              const textAngle = angleDeg - 90;
              const textRadius = innerTrackRadius * 0.72;
              const textX = radius + textRadius * Math.cos(textAngle * (Math.PI / 180));
              const textY = radius + textRadius * Math.sin(textAngle * (Math.PI / 180));

              return (
                <g key={seg.number} className="wheel-slice-group">
                  {/* Slice Segment */}
                  <path
                    d={pathD}
                    fill={seg.color}
                    stroke="#0f172a"
                    strokeWidth="2.5"
                    opacity={seg.isClaimed ? '1' : '0.85'}
                  />

                  {/* Claimed Indicator Glow Highlight */}
                  {seg.isClaimed && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#fef08a"
                      strokeWidth="3.5"
                      strokeDasharray="8 4"
                      opacity="0.9"
                    />
                  )}

                  {/* Segment Number Text */}
                  <g transform={`translate(${textX}, ${textY}) rotate(${angleDeg})`}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontWeight="900"
                      fontSize={totalSegments > 20 ? '20' : '28'}
                      fontFamily="Orbitron, sans-serif"
                      stroke="#070d1e"
                      strokeWidth="4"
                      paintOrder="stroke fill"
                      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}
                    >
                      {seg.number}
                    </text>
                    {seg.isClaimed && (
                      <circle
                        cx="0"
                        cy="18"
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

          {/* Pegs/Pins along circumference */}
          {Array.from({ length: totalSegments }).map((_, i) => {
            const pegAngle = (i * segmentAngle - 90) * (Math.PI / 180);
            const pegX = radius + (innerTrackRadius + 8) * Math.cos(pegAngle);
            const pegY = radius + (innerTrackRadius + 8) * Math.sin(pegAngle);
            return (
              <circle
                key={i}
                cx={pegX}
                cy={pegY}
                r="4.5"
                fill="#f8fafc"
                stroke="#0284c7"
                strokeWidth="1.5"
                style={{ filter: 'drop-shadow(0 0 3px #38bdf8)' }}
              />
            );
          })}

          {/* Center Hub */}
          <circle
            cx={radius}
            cy={radius}
            r="54"
            fill="#090e1a"
            stroke="#00f2fe"
            strokeWidth="5"
            style={{ filter: 'drop-shadow(0 0 12px rgba(0, 242, 254, 0.6))' }}
          />
          <circle
            cx={radius}
            cy={radius}
            r="38"
            fill="#1e1b4b"
            stroke="#8b5cf6"
            strokeWidth="3"
          />
          <text
            x={radius}
            y={radius}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#00f2fe"
            fontWeight="900"
            fontSize="14"
            fontFamily="Orbitron, sans-serif"
            letterSpacing="1"
          >
            CHILLAX
          </text>
        </svg>
      </div>

      {/* Ambient background glow ring */}
      <div className={`wheel-ambient-glow ${isSpinning ? 'spinning-ambient' : ''}`} />
    </div>
  );
}
