import React, { useMemo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import {
  MaterialShape,
  ExpressiveLoadingIndicatorProps,
} from './LoadingIndicator.types';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Normalized 36-vertex polygon path generator for all 23 Material 3 Expressive shapes.
 * Centered on (19, 19) within a 38x38 canvas. Radius base = 16.
 */
const NUM_POINTS = 36;
const CENTER_X = 19;
const CENTER_Y = 19;
const BASE_R = 16;

export function getShapeVertices(shape: MaterialShape): [number, number][] {
  const points: [number, number][] = [];

  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * 2 * Math.PI - Math.PI / 2;
    let rad = BASE_R;

    switch (shape) {
      case MaterialShape.Circle: {
        rad = BASE_R;
        break;
      }
      case MaterialShape.Square: {
        // 4-sided rounded squircle
        const sAngle = (2 * Math.PI) / 4;
        const offset = ((theta + Math.PI / 4) % sAngle + sAngle) % sAngle;
        rad = BASE_R * (0.86 / Math.cos(offset - sAngle / 2));
        rad = Math.min(BASE_R * 1.05, Math.max(BASE_R * 0.72, rad));
        break;
      }
      case MaterialShape.Oval: {
        // Horizontal ellipse
        const a = BASE_R * 1.05;
        const b = BASE_R * 0.78;
        rad = (a * b) / Math.sqrt(Math.pow(b * Math.cos(theta), 2) + Math.pow(a * Math.sin(theta), 2));
        break;
      }
      case MaterialShape.Pill: {
        // Elongated stadium shape
        const a = BASE_R * 1.08;
        const b = BASE_R * 0.68;
        rad = (a * b) / Math.sqrt(Math.pow(b * Math.cos(theta), 2) + Math.pow(a * Math.sin(theta), 2));
        break;
      }
      case MaterialShape.SemiCircle: {
        // Flat on bottom half, rounded dome on top
        if (Math.sin(theta) > 0.1) {
          rad = BASE_R * 0.55;
        } else {
          rad = BASE_R * 0.95;
        }
        break;
      }
      case MaterialShape.Triangle: {
        // 3-pointed equilateral triangle with rounded vertices
        const tAngle = (2 * Math.PI) / 3;
        const offset = ((theta + Math.PI / 2) % tAngle + tAngle) % tAngle;
        rad = BASE_R * (0.68 / Math.cos(offset - tAngle / 2));
        rad = Math.min(BASE_R * 1.08, Math.max(BASE_R * 0.55, rad));
        break;
      }
      case MaterialShape.Pentagon: {
        // 5-sided regular polygon with softened corners
        const pAngle = (2 * Math.PI) / 5;
        const offset = ((theta + Math.PI / 2) % pAngle + pAngle) % pAngle;
        rad = BASE_R * (0.88 / Math.cos(offset - pAngle / 2));
        rad = Math.min(BASE_R, Math.max(BASE_R * 0.68, rad));
        break;
      }
      case MaterialShape.Diamond: {
        // 4-pointed rhombus oriented on point
        const dAngle = (2 * Math.PI) / 4;
        const offset = ((theta) % dAngle + dAngle) % dAngle;
        rad = BASE_R * (0.75 / (Math.abs(Math.cos(offset)) + Math.abs(Math.sin(offset))));
        rad = Math.min(BASE_R * 1.1, Math.max(BASE_R * 0.6, rad));
        break;
      }
      case MaterialShape.Slanted: {
        // Parallelogram / slanted rectangle
        const mod = Math.sin(theta * 2 + 0.4) * 0.22;
        rad = BASE_R * (0.88 + mod);
        break;
      }
      case MaterialShape.Arch: {
        // Cathedral / roman arch (flat base, semicircular top)
        if (theta > 0 && theta < Math.PI) {
          rad = BASE_R * 0.72;
        } else {
          rad = BASE_R * 0.98;
        }
        break;
      }
      case MaterialShape.Arrow: {
        // Directional pointer
        if (theta < -Math.PI / 4 || theta > Math.PI * 0.75) {
          rad = BASE_R * 1.05;
        } else {
          rad = BASE_R * 0.65;
        }
        break;
      }
      case MaterialShape.Fan: {
        // Quarter-circle wedge
        if (theta >= -Math.PI / 2 && theta <= 0) {
          rad = BASE_R * 1.05;
        } else {
          rad = BASE_R * 0.62;
        }
        break;
      }
      case MaterialShape.Gem: {
        // Faceted polygon with beveled shoulders
        if (theta < 0) {
          rad = BASE_R * 0.92;
        } else {
          rad = BASE_R * (0.65 + Math.cos(theta) * 0.25);
        }
        break;
      }
      case MaterialShape.ClamShell: {
        // Undulating lobes / organic scallop
        const mod = Math.sin(theta * 5) * 0.18 + Math.cos(theta * 2) * 0.08;
        rad = BASE_R * (0.86 + mod);
        break;
      }
      case MaterialShape.Ghostish: {
        // Dome with foot notches
        if (Math.sin(theta) > 0.3) {
          const notch = Math.sin(theta * 8) * 0.14;
          rad = BASE_R * (0.82 + notch);
        } else {
          rad = BASE_R * 0.96;
        }
        break;
      }
      case MaterialShape.Sunny: {
        // 8-pointed rounded sunburst with deep valleys
        const mod = Math.sin(theta * 8) * 0.28;
        rad = BASE_R * (0.82 + mod);
        break;
      }
      case MaterialShape.VerySunny: {
        // 16-point dense radiant sunburst
        const mod = Math.sin(theta * 16) * 0.22;
        rad = BASE_R * (0.85 + mod);
        break;
      }
      case MaterialShape.SoftBurst: {
        // Organic pillowy starburst with convex lobes
        const mod = Math.sin(theta * 8) * 0.24;
        rad = BASE_R * (0.82 + mod);
        break;
      }
      case MaterialShape.Cookie4Sided: {
        // 4-leaf clover / 4-lobed scallop
        const mod = Math.sin(theta * 4) * 0.22;
        rad = BASE_R * (0.84 + mod);
        break;
      }
      case MaterialShape.Cookie6Sided: {
        // 6-lobed scalloped cookie
        const mod = Math.sin(theta * 6) * 0.2;
        rad = BASE_R * (0.85 + mod);
        break;
      }
      case MaterialShape.Cookie7Sided: {
        // 7-lobed asymmetric scalloped cookie
        const mod = Math.sin(theta * 7) * 0.18;
        rad = BASE_R * (0.85 + mod);
        break;
      }
      case MaterialShape.Cookie9Sided: {
        // 9-lobed scalloped cookie
        const mod = Math.sin(theta * 9) * 0.18;
        rad = BASE_R * (0.85 + mod);
        break;
      }
      case MaterialShape.Cookie12Sided: {
        // 12-lobed gear / flower
        const mod = Math.sin(theta * 12) * 0.16;
        rad = BASE_R * (0.86 + mod);
        break;
      }
      default: {
        rad = BASE_R;
      }
    }

    const x = CENTER_X + rad * Math.cos(theta);
    const y = CENTER_Y + rad * Math.sin(theta);
    points.push([x, y]);
  }

  return points;
}

// Convert vertices into an SVG smooth cubic Bezier path
function verticesToSvgPath(vertices: [number, number][]): string {
  const n = vertices.length;
  if (n === 0) return '';

  let d = `M ${vertices[0][0].toFixed(2)} ${vertices[0][1].toFixed(2)}`;

  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    const prev = vertices[(i - 1 + n) % n];
    const nextNext = vertices[(i + 2) % n];

    // Smooth cardinal spline tangent control points
    const cp1x = curr[0] + (next[0] - prev[0]) * 0.2;
    const cp1y = curr[1] + (next[1] - prev[1]) * 0.2;
    const cp2x = next[0] - (nextNext[0] - curr[0]) * 0.2;
    const cp2y = next[1] - (nextNext[1] - curr[1]) * 0.2;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next[0].toFixed(2)} ${next[1].toFixed(2)}`;
  }

  d += ' Z';
  return d;
}

// Precompute vertex tables for high-performance lookup
const VERTEX_CACHE = new Map<MaterialShape, [number, number][]>();
Object.values(MaterialShape).forEach((shape) => {
  VERTEX_CACHE.set(shape, getShapeVertices(shape));
});

/**
 * Standard M3 Expressive Morph Sequence:
 * SoftBurst -> Cookie9Sided -> Pentagon -> Pill -> Sunny -> Cookie4Sided -> Oval
 *
 * Icon Mode (containsIcon = true): Exclude Pentagon for icon clearance
 */
const STANDARD_SEQUENCE: MaterialShape[] = [
  MaterialShape.SoftBurst,
  MaterialShape.Cookie9Sided,
  MaterialShape.Pentagon,
  MaterialShape.Pill,
  MaterialShape.Sunny,
  MaterialShape.Cookie4Sided,
  MaterialShape.Oval,
];

const ICON_SEQUENCE: MaterialShape[] = [
  MaterialShape.SoftBurst,
  MaterialShape.Cookie9Sided,
  MaterialShape.Pill,
  MaterialShape.Sunny,
  MaterialShape.Cookie4Sided,
  MaterialShape.Oval,
];

/**
 * 2nd-Order Underdamped Harmonic Spring Engine Constants:
 * stiffness = 180, dampingRatio = 0.6, morphScale = 0.14
 * wn = sqrt(180) ≈ 13.4164 rad/s
 * wd = wn * sqrt(1 - 0.6^2) = 13.4164 * 0.8 ≈ 10.7331 rad/s
 */
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING_RATIO = 0.6;
const MORPH_SCALE_SQUISH = 0.14;
const WN = Math.sqrt(SPRING_STIFFNESS); // ~13.4164
const WD = WN * Math.sqrt(1 - SPRING_DAMPING_RATIO * SPRING_DAMPING_RATIO); // ~10.7331
const SPRING_MAX_VELOCITY = 6.2; // Peak analytical velocity for normalization
const STEP_INTERVAL_MS = 650;
const CONTINUOUS_CYCLE_MS = 4666;

export const ExpressiveLoadingIndicator: React.FC<ExpressiveLoadingIndicatorProps> = React.memo(
  function ExpressiveLoadingIndicator({
    size = 38,
    color,
    containsIcon = false,
    icon,
    sequence,
    style,
    accessibilityLabel = 'Loading',
    testID,
  }) {
    const { colors } = useTheme();
    const indicatorColor = color || colors.primary;

    const shapes = useMemo(() => {
      if (sequence && sequence.length > 0) return sequence;
      return containsIcon ? ICON_SEQUENCE : STANDARD_SEQUENCE;
    }, [sequence, containsIcon]);

    // Active morph shape state
    const [fromIndex, setFromIndex] = React.useState(0);
    const [toIndex, setToIndex] = React.useState(1);
    const [pathData, setPathData] = React.useState('');

    // Physics Engine Shared Values
    const continuousRotation = useSharedValue(0); // 0 to 360 linear continuous drift
    const accumulatedImpulseRotation = useSharedValue(0); // Settled +60 deg morph rotations
    const currentImpulseRotation = useSharedValue(0); // Active frame +60 * pos(t)
    const dynamicScale = useSharedValue(1); // Jelly squish & stretch: 1 + vel * factor
    const morphProgress = useSharedValue(0); // Clamped pos(t) [0.0 -> 1.0]

    // Cycle cadence timer (every 650ms, atomic batch update)
    const springStartTime = useRef<number>(Date.now());
    const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Continuous drift linear loop (0 to 360 over 4666ms)
    const baseLoopStartTime = useRef<number>(Date.now());

    const fromVerts = useMemo(
      () => VERTEX_CACHE.get(shapes[fromIndex % shapes.length]) || getShapeVertices(shapes[0]),
      [shapes, fromIndex]
    );
    const toVerts = useMemo(
      () => VERTEX_CACHE.get(shapes[toIndex % shapes.length]) || getShapeVertices(shapes[1]),
      [shapes, toIndex]
    );

    // Advance shape sequence atomically every 650ms
    useEffect(() => {
      springStartTime.current = Date.now();
      stepTimerRef.current = setInterval(() => {
        // State batching: accumulate settled rotation and advance shape indices
        accumulatedImpulseRotation.value += 60;
        springStartTime.current = Date.now();
        setFromIndex((prev) => (prev + 1) % shapes.length);
        setToIndex((prev) => (prev + 2) % shapes.length);
      }, STEP_INTERVAL_MS);

      return () => {
        if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      };
    }, [shapes]);

    // Frame Callback evaluating analytical damped harmonic spring equations per-frame
    useFrameCallback(() => {
      const now = Date.now();

      // 1. Continuous Linear Drift (4666ms cycle)
      const driftElapsed = (now - baseLoopStartTime.current) % CONTINUOUS_CYCLE_MS;
      continuousRotation.value = (driftElapsed / CONTINUOUS_CYCLE_MS) * 360;

      // 2. Analytical 2nd-order damped harmonic spring evaluation
      const t = Math.max(0, (now - springStartTime.current) / 1000); // seconds

      const expDecay = Math.exp(-SPRING_DAMPING_RATIO * WN * t);
      const cosVal = Math.cos(WD * t);
      const sinVal = Math.sin(WD * t);

      // pos(t) = 1 - e^(-zeta*wn*t) * (cos(wd*t) + (zeta*wn/wd) * sin(wd*t))
      const pos =
        1 -
        expDecay *
          (cosVal + ((SPRING_DAMPING_RATIO * WN) / WD) * sinVal);

      // vel(t) = e^(-zeta*wn*t) * (wn^2 / wd) * sin(wd*t)
      const vel = expDecay * ((WN * WN) / WD) * sinVal;

      // Morph progress clamped between 0 and 1 (never overshoot vertex interpolation)
      morphProgress.value = Math.min(1.0, Math.max(0.0, pos));

      // Elastic squash-and-stretch jelly deformation (up to 14%)
      dynamicScale.value = 1.0 + (vel * MORPH_SCALE_SQUISH) / SPRING_MAX_VELOCITY;

      // Impulse Rotation: pos(t) * 60 degrees
      currentImpulseRotation.value = pos * 60;
    });

    // Update interpolated SVG path
    useEffect(() => {
      let animFrameId: number;

      const updateMorphPath = () => {
        const p = morphProgress.value;
        const interpolated: [number, number][] = [];

        for (let i = 0; i < NUM_POINTS; i++) {
          const x = fromVerts[i][0] + (toVerts[i][0] - fromVerts[i][0]) * p;
          const y = fromVerts[i][1] + (toVerts[i][1] - fromVerts[i][1]) * p;
          interpolated.push([x, y]);
        }

        setPathData(verticesToSvgPath(interpolated));
        animFrameId = requestAnimationFrame(updateMorphPath);
      };

      animFrameId = requestAnimationFrame(updateMorphPath);
      return () => cancelAnimationFrame(animFrameId);
    }, [fromVerts, toVerts]);

    // Composite dual-layer rotation and dynamic jelly squish-scale
    const animatedTransformStyle = useAnimatedStyle(() => {
      const totalRotation =
        continuousRotation.value +
        accumulatedImpulseRotation.value +
        currentImpulseRotation.value;

      return {
        transform: [
          { rotate: `${totalRotation}deg` },
          { scale: dynamicScale.value },
        ],
      };
    });

    return (
      <View
        style={[
          styles.container,
          { width: size, height: size },
          style,
        ]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {/* Morphing Polygon Layer */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.centered,
            animatedTransformStyle,
          ]}
        >
          <Svg
            width={size}
            height={size}
            viewBox="0 0 38 38"
            style={StyleSheet.absoluteFill}
          >
            <Path
              d={pathData || verticesToSvgPath(fromVerts)}
              fill={indicatorColor}
            />
          </Svg>
        </Animated.View>

        {/* Interior centered icon (if present) */}
        {icon && (
          <View style={[StyleSheet.absoluteFill, styles.centered]}>
            {icon}
          </View>
        )}
      </View>
    );
  }
);

// Fallback ref creation helper
function useRef<T>(initialValue: T): React.MutableRefObject<T> {
  return React.useRef(initialValue);
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
