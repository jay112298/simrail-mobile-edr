// Line schematic — trains plotted by kilometre post against the post they
// are approaching. Pure SVG: no tile server, no dependency, works offline,
// which matters for an app that ships as a self-contained APK.
//
// For dispatching this beats a geographic map: what matters is approach
// order and spacing on each line, not where the train is on a globe.

import type { Train } from './data'
import {
  WINDOW_KM,
  type SchematicLine,
  type SchematicMark,
  type SchematicTrain,
} from './lib/schematic'
import { SIGNAL_HEX, shortDelay } from './lib/ui'
import { hapticTap } from './lib/haptic'

const HEIGHT = 460
const AXIS_X = 116
const SCALE = HEIGHT / (WINDOW_KM * 2)

/** Higher kilometre posts render at the top. */
const yFor = (km: number, postKm: number) =>
  (postKm + WINDOW_KM - km) * SCALE

/**
 * Nudge labels apart so trains close together stay readable. Entries arrive
 * sorted by y; each is pushed below the previous one when they would collide.
 */
function spread(ys: number[], minGap: number): number[] {
  const out: number[] = []
  let last = -Infinity
  for (const y of ys) {
    const placed = Math.max(y, last + minGap)
    out.push(placed)
    last = placed
  }
  return out
}

function TrainChip({
  t,
  y,
  anchorY,
  onOpen,
}: {
  t: SchematicTrain
  y: number
  anchorY: number
  onOpen: (train: Train) => void
}) {
  const delay = shortDelay(t.train.delay)
  return (
    <g
      className="cursor-pointer"
      onClick={() => {
        hapticTap()
        onOpen(t.train)
      }}
    >
      {/* Leader from the true position on the axis to the offset label. */}
      <line
        x1={AXIS_X}
        y1={anchorY}
        x2={AXIS_X + 14}
        y2={y}
        stroke="#334155"
        strokeWidth="1"
      />
      <circle cx={AXIS_X} cy={anchorY} r="5" fill={SIGNAL_HEX[t.train.signalState]} />
      <text
        x={AXIS_X + 18}
        y={y - 2}
        className="fill-white font-mono font-bold"
        style={{ fontSize: 12 }}
      >
        {t.train.number}
      </text>
      <text
        x={AXIS_X + 18}
        y={y + 10}
        className="fill-slate-500"
        style={{ fontSize: 9 }}
      >
        {t.train.speed} km/h · {t.distanceKm.toFixed(1)} km
        {t.train.delay !== 0 ? ` · ${delay.text}` : ''}
      </text>
      {/* Direction of travel along the line. */}
      {t.direction !== 0 && (
        <text
          x={AXIS_X - 8}
          y={anchorY + 4}
          textAnchor="end"
          className={t.approaching ? 'fill-sky-400' : 'fill-slate-600'}
          style={{ fontSize: 11 }}
        >
          {t.direction === 1 ? '▲' : '▼'}
        </text>
      )}
    </g>
  )
}

/**
 * Points on a line can sit a few hundred metres apart, which collides at this
 * scale. Post marks are always kept — they are the reference — and other
 * marks only when they clear everything already placed.
 */
function thinMarks(marks: SchematicMark[], postKm: number): SchematicMark[] {
  const MIN_GAP_PX = 15
  const kept: SchematicMark[] = marks.filter((m) => m.isPost)
  for (const m of marks) {
    if (m.isPost) continue
    const y = yFor(m.km, postKm)
    if (kept.every((k) => Math.abs(yFor(k.km, postKm) - y) >= MIN_GAP_PX)) {
      kept.push(m)
    }
  }
  return kept
}

function LineDiagram({
  group,
  onOpen,
}: {
  group: SchematicLine
  onOpen: (t: Train) => void
}) {
  const postY = yFor(group.postKm, group.postKm)
  const marks = thinMarks(group.marks, group.postKm)
  const anchors = group.trains.map((t) => yFor(t.km, group.postKm))
  // Order by screen position before spreading, then map back.
  const order = group.trains
    .map((t, i) => ({ t, i, y: anchors[i] }))
    .sort((a, b) => a.y - b.y)
  const spreadYs = spread(
    order.map((o) => o.y),
    26,
  )

  return (
    <section className="mb-4">
      <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-4 mb-1">
        Line {group.line}
        <span className="ml-1.5 text-slate-600 normal-case tracking-normal">
          · {group.trains.length} train{group.trains.length === 1 ? '' : 's'}{' '}
          within {WINDOW_KM} km
        </span>
      </h3>
      <svg
        width="100%"
        viewBox={`0 0 375 ${HEIGHT}`}
        className="block"
        role="img"
        aria-label={`Line ${group.line} schematic`}
      >
        {/* The running line */}
        <line
          x1={AXIS_X}
          y1={0}
          x2={AXIS_X}
          y2={HEIGHT}
          stroke="#1e293b"
          strokeWidth="3"
        />

        {marks.map((m) => {
          const y = yFor(m.km, group.postKm)
          if (y < 6 || y > HEIGHT - 6) return null
          return (
            <g key={`${m.name}-${m.km}`}>
              <line
                x1={AXIS_X - 5}
                y1={y}
                x2={AXIS_X + 5}
                y2={y}
                stroke={m.isPost ? '#38bdf8' : '#334155'}
                strokeWidth={m.isPost ? 2 : 1}
              />
              <text
                x={AXIS_X - 10}
                y={y + 3}
                textAnchor="end"
                className={m.isPost ? 'fill-sky-300' : 'fill-slate-500'}
                style={{ fontSize: m.isPost ? 11 : 9 }}
              >
                {m.name.length > 18 ? `${m.name.slice(0, 17)}…` : m.name}
              </text>
            </g>
          )
        })}

        {/* This post, drawn over the marks so it always reads clearly. */}
        <line
          x1={AXIS_X - 22}
          y1={postY}
          x2={AXIS_X + 22}
          y2={postY}
          stroke="#38bdf8"
          strokeWidth="2"
        />

        {order.map((o, i) => (
          <TrainChip
            key={o.t.train.number}
            t={o.t}
            y={spreadYs[i]}
            anchorY={o.y}
            onOpen={onOpen}
          />
        ))}
      </svg>
    </section>
  )
}

export default function SchematicMap({
  lines,
  postName,
  onOpen,
}: {
  lines: SchematicLine[]
  postName: string
  onOpen: (t: Train) => void
}) {
  if (lines.length === 0) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center pb-32">
        <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-4 text-2xl">
          🗺
        </div>
        <h2 className="text-lg font-semibold text-white mb-1">
          Nothing on the line
        </h2>
        <p className="text-sm text-slate-400 max-w-xs">
          No train is within {WINDOW_KM} km of {postName} on a line this post
          controls.
        </p>
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-y-auto pt-3 pb-24">
      <p className="px-4 text-[11px] text-slate-500 mb-3">
        Position is interpolated from the booked schedule, by kilometre post —
        not a geographic map. Tap a train for details.
      </p>
      {lines.map((g) => (
        <LineDiagram key={g.line} group={g} onOpen={onOpen} />
      ))}
    </main>
  )
}
