import React, { useEffect, useRef, useState, useMemo } from 'react';
import { sounds } from '../utils/sound';

// Majestic jewel-toned & neon arcade palette for wheel segments
const SEGMENT_PALETTE = [
  { main: '#0284c7', light: '#38bdf8', dark: '#0369a1' }, // Electric Sapphire
  { main: '#7c3aed', light: '#a855f7', dark: '#5b21b6' }, // Royal Amethyst
  { main: '#db2777', light: '#f472b6', dark: '#9d174d' }, // Neon Magenta Ruby
  { main: '#d97706', light: '#fbbf24', dark: '#b45309' }, // Imperial Gold
  { main: '#2563eb', light: '#60a5fa', dark: '#1d4ed8' }, // Cyber Cobalt
  { main: '#9333ea', light: '#c084fc', dark: '#6b21a8' }, // Vivid Violet
  { main: '#e11d48', light: '#fb7185', dark: '#be123c' }, // Crimson Rose
  { main: '#0891b2', light: '#22d3ee', dark: '#0e7490' }, // Aqua Topaz
  { main: '#ca8a04', light: '#facc15', dark: '#a16207' }, // Sunburst Amber
  { main: '#4f46e5', light: '#818cf8', dark: '#3730a3' }  // Deep Indigo
];

export function ArcadeWheel({
  wheelNumbers = null,
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

  // Build wheel numbers with 0 at the top (12 o'clock) and 00 directly opposite (6 o'clock)
  const numbers = useMemo(() => {
    let raw = [];
    if (Array.isArray(wheelNumbers) && wheelNumbers.length > 0) {
      raw = wheelNumbers.map(String);
    } else {
      for (let i = min; i <= max; i++) {
        raw.push(String(i));
      }
      return ['0', ...raw.slice(0, Math.floor(raw.length / 2)), '00', ...raw.slice(Math.floor(raw.length / 2))];
    }

    const has0 = raw.includes('0');
    const has00 = raw.includes('00');
    if (has0 && has00) {
      const nonZeros = raw.filter((n) => n !== '0' && n !== '00');
      const half = Math.floor(nonZeros.length / 2);
      return ['0', ...nonZeros.slice(0, half), '00', ...nonZeros.slice(half)];
    }
    return raw;
  }, [wheelNumbers, min, max]);

  const totalSegments = Math.max(1, numbers.length);
  const segmentAngle = 360 / totalSegments;

  // Wheel dimensions
  const wheelSize = 540;
  const radius = wheelSize / 2;
  const outerRimRadius = radius - 6;
  const bezelInnerRadius = outerRimRadius - 24;
  const innerTrackRadius = bezelInnerRadius - 4;

  // Generate segments data with emerald jewel 0 / 00 slots & rich gradients
  const segments = useMemo(() => {
    const list = [];
    let colorIndex = 0;
    for (let i = 0; i < totalSegments; i++) {
      const num = numbers[i];
      const isClaimed = claimedNumbers.some((c) => String(c) === String(num));
      const isWinner = winningNumber !== null && String(winningNumber) === String(num);
      const isZero = String(num) === '0' || String(num) === '00';

      let palette;
      if (String(num) === '0') {
        palette = { main: '#059669', light: '#34d399', dark: '#065f46' }; // Vibrant Emerald 0
      } else if (String(num) === '00') {
        palette = { main: '#047857', light: '#10b981', dark: '#064e3b' }; // Deep Emerald 00
      } else {
        palette = SEGMENT_PALETTE[colorIndex % SEGMENT_PALETTE.length];
        colorIndex++;
      }

      list.push({
        index: i,
        number: num,
        isZero,
        isClaimed,
        isWinner,
        color: palette.main,
        lightColor: palette.light,
        darkColor: palette.dark
      });
    }
    return list;
  }, [numbers, totalSegments, claimedNumbers, winningNumber]);

  // Handle spin trigger
  useEffect(() => {
    if (isSpinning && winningNumber !== null && !isCurrentlySpinningRef.current) {
      isCurrentlySpinningRef.current = true;
      sounds.startSpinSounds(spinDurationMs);

      const winningIdx = numbers.findIndex((n) => String(n) === String(winningNumber));
      const safeIdx = winningIdx >= 0 ? winningIdx : 0;
      const targetSliceCenterAngle = safeIdx * segmentAngle;

      const currentNorm = currentRotationRef.current % 360;
      const desiredNorm = (360 - (targetSliceCenterAngle % 360)) % 360;

      let delta = desiredNorm - currentNorm;
      if (delta <= 0) {
        delta += 360;
      }

      // 12 full 360-degree spins in 5 seconds for high-velocity arcade action
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
  }, [isSpinning, winningNumber, numbers, segmentAngle, spinDurationMs, onSpinComplete]);

  // Create SVG slice path centered on slice k
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

  // Create outer arc highlight for claimed numbers
  const createOuterArcPath = (index, rOuter, rInner) => {
    const centerDeg = -90 + index * segmentAngle;
    const startAngle = (centerDeg - segmentAngle / 2 + 0.8) * (Math.PI / 180);
    const endAngle = (centerDeg + segmentAngle / 2 - 0.8) * (Math.PI / 180);

    const x1 = radius + rOuter * Math.cos(startAngle);
    const y1 = radius + rOuter * Math.sin(startAngle);
    const x2 = radius + rOuter * Math.cos(endAngle);
    const y2 = radius + rOuter * Math.sin(endAngle);

    const x3 = radius + rInner * Math.cos(endAngle);
    const y3 = radius + rInner * Math.sin(endAngle);
    const x4 = radius + rInner * Math.cos(startAngle);
    const y4 = radius + rInner * Math.sin(startAngle);

    return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 0 0 ${x4} ${y4} Z`;
  };

  // 24 Marquee LED lights around the outer casino bezel
  const marqueeBulbs = useMemo(() => {
    const count = 28;
    const bulbs = [];
    const bulbRadius = (outerRimRadius + bezelInnerRadius) / 2;
    for (let i = 0; i < count; i++) {
      const deg = -90 + (i * 360) / count;
      const rad = deg * (Math.PI / 180);
      bulbs.push({
        id: i,
        cx: radius + bulbRadius * Math.cos(rad),
        cy: radius + bulbRadius * Math.sin(rad),
        isGold: i % 2 === 0
      });
    }
    return bulbs;
  }, [radius, outerRimRadius, bezelInnerRadius]);

  return (
    <div className={`arcade-wheel-container ${isSpinning ? 'wheel-is-spinning' : ''}`}>
      {/* Majestic Royal Pointer at 12 O'Clock */}
      <div className={`wheel-pointer ${isSpinning ? 'pointer-wiggling' : ''}`}>
        <svg viewBox="0 0 56 64" className="pointer-svg">
          <defs>
            <filter id="pointer-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#f59e0b" floodOpacity="0.95" />
            </filter>
            <linearGradient id="pointer-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef9c3" />
              <stop offset="40%" stopColor="#fbbf24" />
              <stop offset="80%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
            <linearGradient id="pointer-bevel" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          {/* Outer Crown Shield */}
          <polygon
            points="28,58 6,12 18,4 28,10 38,4 50,12"
            fill="url(#pointer-gold-grad)"
            stroke="#fef08a"
            strokeWidth="2.5"
            filter="url(#pointer-shadow)"
          />
          {/* Inner 3D facet */}
          <polygon
            points="28,53 11,14 28,19 45,14"
            fill="url(#pointer-bevel)"
          />
          {/* Center Cyan Jewel */}
          <circle cx="28" cy="18" r="7" fill="#070d1e" stroke="#fef08a" strokeWidth="2" />
          <circle cx="28" cy="18" r="4.5" fill="#00f2fe" />
          <circle cx="26.5" cy="16.5" r="1.5" fill="#ffffff" />
        </svg>
      </div>

      {/* Rotating Wheel Group */}
      <div
        className="wheel-rotating-wrapper"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: isSpinning
            ? `transform ${spinDurationMs}ms cubic-bezier(0.08, 0.88, 0.16, 1)`
            : 'none'
        }}
      >
        <svg viewBox={`0 0 ${wheelSize} ${wheelSize}`} className="wheel-svg">
          <defs>
            <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Luxury Metallic Outer Bezel Gradient */}
            <radialGradient id="bezel-metallic" cx="50%" cy="50%" r="50%">
              <stop offset="84%" stopColor="#050b1a" />
              <stop offset="89%" stopColor="#1e293b" />
              <stop offset="93%" stopColor="#0f172a" />
              <stop offset="97%" stopColor="#f59e0b" />
              <stop offset="99%" stopColor="#fef08a" />
              <stop offset="100%" stopColor="#78350f" />
            </radialGradient>

            {/* 3D Specular & Vignette Overlay for Curved Glossy Wheel Surface */}
            <radialGradient id="wheel-3d-lighting" cx="42%" cy="38%" r="60%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.03" />
              <stop offset="80%" stopColor="#000000" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.52" />
            </radialGradient>

            {/* Golden Claimed Tab Gradient */}
            <linearGradient id="claimed-gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>

            {/* Peg 3D Chrome/Gold Gradient */}
            <radialGradient id="peg-metallic" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="45%" stopColor="#fef08a" />
              <stop offset="85%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#78350f" />
            </radialGradient>
          </defs>

          {/* Outer Royal Bezel Rim */}
          <circle
            cx={radius}
            cy={radius}
            r={outerRimRadius}
            fill="url(#bezel-metallic)"
            stroke="#fbbf24"
            strokeWidth="3"
          />

          {/* Inner Cyan Neon Ring inside Bezel */}
          <circle
            cx={radius}
            cy={radius}
            r={bezelInnerRadius}
            fill="#050b18"
            stroke="#00f2fe"
            strokeWidth="2.5"
          />

          {/* Chasing Marquee LED Bulbs on Bezel */}
          <g className="wheel-marquee-bulbs">
            {marqueeBulbs.map((b) => (
              <g key={b.id} className={`marquee-bulb ${b.isGold ? 'bulb-gold' : 'bulb-cyan'}`}>
                <circle
                  cx={b.cx}
                  cy={b.cy}
                  r="5.5"
                  fill={b.isGold ? 'rgba(251, 191, 36, 0.28)' : 'rgba(0, 242, 254, 0.28)'}
                />
                <circle
                  cx={b.cx}
                  cy={b.cy}
                  r="3.4"
                  fill={b.isGold ? '#fef08a' : '#67e8f9'}
                  stroke={b.isGold ? '#d97706' : '#0284c7'}
                  strokeWidth="1"
                />
              </g>
            ))}
          </g>

          {/* Wheel Slices */}
          <g>
            {segments.map((seg) => {
              const pathD = createSlicePath(seg.index, innerTrackRadius);
              const outerBadgeD = createOuterArcPath(
                seg.index,
                innerTrackRadius - 2,
                innerTrackRadius - 16
              );

              // Position text along the center ray of slice
              const centerDeg = -90 + seg.index * segmentAngle;
              const rad = centerDeg * (Math.PI / 180);
              const textRadius = innerTrackRadius * 0.7;
              const textX = radius + textRadius * Math.cos(rad);
              const textY = radius + textRadius * Math.sin(rad);

              let textRot = centerDeg + 90;
              const norm = ((textRot % 360) + 360) % 360;
              if (norm > 90 && norm < 270) {
                textRot += 180;
              }

              return (
                <g key={seg.number} className="wheel-slice-item">
                  {/* Base Slice Wedge */}
                  <path
                    d={pathD}
                    fill={seg.color}
                    stroke="#070d1e"
                    strokeWidth="2.2"
                    opacity={seg.isClaimed ? 1 : 0.92}
                  />

                  {/* Subtle inner spoke accent */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.14)"
                    strokeWidth="1"
                  />

                  {/* Golden Outer Arc Banner & Glow for Claimed Numbers */}
                  {seg.isClaimed && (
                    <>
                      <path
                        d={outerBadgeD}
                        fill="url(#claimed-gold-grad)"
                        stroke="#ffffff"
                        strokeWidth="1"
                      />
                      <path
                        d={pathD}
                        fill="rgba(254, 240, 138, 0.12)"
                        stroke="#fde047"
                        strokeWidth="3.2"
                      />
                    </>
                  )}

                  {/* Winning Slice Spotlight Highlight */}
                  {seg.isWinner && !isSpinning && (
                    <path
                      d={pathD}
                      fill="rgba(254, 240, 138, 0.28)"
                      stroke="#ffffff"
                      strokeWidth="4"
                    />
                  )}

                  {/* Number Label */}
                  <g transform={`translate(${textX}, ${textY}) rotate(${textRot})`}>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={seg.isClaimed ? '#fef9c3' : '#ffffff'}
                      fontWeight="900"
                      fontSize={totalSegments > 24 ? '19' : totalSegments > 20 ? '23' : '27'}
                      fontFamily="Orbitron, sans-serif"
                      stroke="#050b18"
                      strokeWidth="4.5"
                      paintOrder="stroke fill"
                      style={{ filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.92))' }}
                    >
                      {seg.number}
                    </text>
                    {seg.isClaimed && (
                      <circle
                        cx="0"
                        cy="16"
                        r="4"
                        fill="#fef08a"
                        stroke="#78350f"
                        strokeWidth="1.5"
                      />
                    )}
                  </g>
                </g>
              );
            })}
          </g>

          {/* 3D Curved Gloss & Vignette Overlay */}
          <circle
            cx={radius}
            cy={radius}
            r={innerTrackRadius}
            fill="url(#wheel-3d-lighting)"
            pointerEvents="none"
          />

          {/* Decorative Inner Gold Ring around Hub */}
          <circle
            cx={radius}
            cy={radius}
            r={innerTrackRadius * 0.34}
            fill="none"
            stroke="rgba(251, 191, 36, 0.45)"
            strokeWidth="2"
            strokeDasharray="6 4"
            pointerEvents="none"
          />

          {/* 3D Metallic Pegs/Pins at slice boundaries */}
          {Array.from({ length: totalSegments }).map((_, i) => {
            const pegDeg = -90 + i * segmentAngle - segmentAngle / 2;
            const pegRad = pegDeg * (Math.PI / 180);
            const pegX = radius + (innerTrackRadius - 2) * Math.cos(pegRad);
            const pegY = radius + (innerTrackRadius - 2) * Math.sin(pegRad);
            return (
              <circle
                key={i}
                cx={pegX}
                cy={pegY}
                r="4.5"
                fill="url(#peg-metallic)"
                stroke="#0f172a"
                strokeWidth="1.2"
                style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.85))' }}
              />
            );
          })}
        </svg>
      </div>

      {/* Stationary 3D Royal Center Medallion */}
      <div className="wheel-stationary-hub">
        <div className="hub-outer-gold-ring">
          <div className="hub-inner-glow">
            <span className="hub-crown-stars">★ ★ ★</span>
            <span className="hub-brand-text">CHILLAX</span>
            <span className="hub-sub-text">SPIN &amp; WIN</span>
          </div>
        </div>
      </div>

      {/* Ambient background glow ring */}
      <div className={`wheel-ambient-glow ${isSpinning ? 'spinning-ambient' : ''}`} />
    </div>
  );
}
