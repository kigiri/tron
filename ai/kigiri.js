const SIZE = 100
const MAX = SIZE * SIZE
const MAP = new Uint8Array(MAX)
const [FREE, OCCUPIED, FILLER, PREDICTION] = MAP.keys()

/// AI CODE
const inBounds = n => n < SIZE && n >= 0
const isInBounds = ({ x, y }) => inBounds(x) && inBounds(y)
const addToMap = ({ x, y }) => MAP[x * SIZE + y] = OCCUPIED
const isFree = ({ x, y }) => MAP[x * SIZE + y] === FREE
const isOccupied = ({ x, y }) => MAP[x * SIZE + y] === OCCUPIED

const pref = [ 1, 2, 0, -1 ]
const calcArea = (mask = new Set) => {
  const scoreMap = new Uint16Array(MAX)
  const areas = new Map()

  let i = -1
  let areaIndex
  while (++i < MAX) {
    if (MAP[i] || mask.has(i)) {
      areaIndex = undefined
      continue
    }
    const topArea = areas.get(scoreMap[i - SIZE])
    if (areaIndex) {
      const area = areas.get(areaIndex)
      area.total++
      if (topArea && (topArea !== area)) {
        topArea.total += area.total
        if (area.indexes) {
          topArea.indexes = (topArea.indexes || []).concat(area.indexes)
        }
        (topArea.indexes || (topArea.indexes = [])).push(area.i)
        for (const index of topArea.indexes) {
          areas.set(index, topArea)
        }
        areaIndex = topArea.i
      }
    } else if (topArea) {
      areaIndex = topArea.i
      topArea.total++
    } else {
      areaIndex = areas.size + 1
      areas.set(areaIndex, { total: 1, i: areaIndex })
    }
    scoreMap[i] = areaIndex
    if (((i + 1) % SIZE) === 0) {
      areaIndex = undefined
    }
  }
  return { scoreMap, areas }
}

const NO_AREA = { i: -1, total: 0 }
const nexter = [
  ({ x, y }) => ({ x, y: y - 1 }),
  ({ x, y }) => ({ x: x + 1, y }),
  ({ x, y }) => ({ x, y: y + 1 }),
  ({ x, y }) => ({ x: x - 1, y }),
]
const guessNext = coord => nexter[coord.cardinal](coord)
const addCoordToSet = (set, coord) => set.add(coord.index)
const addGuessToSet = (set, coord) => set
  .add(coord.index)
  .add(toIndex(guessNext(coord)))

const genCountMap = (aiCoords, otherAIsCoords) => {
  const { scoreMap, areas } = calcArea()

  // Flag AIs area
  for (const coord of aiCoords) {
    (areas.get(scoreMap[coord.index]) || NO_AREA).keep = true
  }

  // Fill the empty spots so they are ignored later on
  let i = -1
  while (++i < MAX) {
    if (MAP[i]) continue
    const area = areas.get(scoreMap[i])
    area && !area.keep && (MAP[i] = FILLER)
  }

  const planA = calcArea(otherAIsCoords.reduce(addCoordToSet, new Set))
  const planB = calcArea(otherAIsCoords.reduce(addGuessToSet, new Set))

  // set ai areas
  const aiAreas = new Set
  for (const coord of aiCoords) {
    const area = areas.get(scoreMap[coord.index]) || NO_AREA
    const planATotal = (planA.areas.get(planA.scoreMap[coord.index]) || NO_AREA).total
    const planBTotal = (planB.areas.get(planB.scoreMap[coord.index]) || NO_AREA).total
    coord.score = area.total + (planATotal * 3) + planBTotal // test for rate
    coord.areaIndex = area.i
    aiAreas.add(area)
  }

  for (const coord of otherAIsCoords) {
    coord.areaIndex = (areas.get(scoreMap[coord.index]) || NO_AREA).i
  }

  return [ ...aiAreas ]
}

const flatten = (a, b) => a.concat(b)
const toIndex = ({ x, y }) => x * SIZE + y
const getPossibleMovesFrom = ({ x, y }) => [
  { x, y: y + 1 },
  { x, y: y - 1 },
  { x: x + 1, y },
  { x: x - 1, y },
].filter(isInBounds).filter(isFree)
const addIndex = p => p.index = toIndex(p)
const byDist = (a, b) => b.dist - a.dist
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const update = ({ ais, ai }) => {
  ais.forEach(addToMap)
  const possibleCoords = ai.coords
    .filter(isInBounds)
    .filter(isFree)

  const otherAIs = ais.filter(p => p !== ai)
  const otherAIsCoords = otherAIs
    .map(p => p.coords)
    .reduce(flatten, [])
    .filter(isInBounds)
    .filter(isFree)

  ais.forEach(addIndex)
  possibleCoords.forEach(addIndex)
  otherAIsCoords.forEach(addIndex)

  const aiAreas = genCountMap(possibleCoords, otherAIsCoords)
  const aiAreasIndex = aiAreas.map(pa => pa.i)
  const maxValue = possibleCoords.reduce((a, b) => ({ score: Math.max(a.score, b.score) }), { score: 0 }).score
  possibleCoords.forEach(coord => coord.ratio = coord.score / maxValue)

  const otherAIsInSameArea = otherAIs
    .filter(p => p.coords.some(c => aiAreasIndex.includes(c.areaIndex)))

  otherAIsInSameArea
    .map(p => p.dist = dist(p, ai))
    .sort(byDist)

  const nearestAI = otherAIsInSameArea[0] || ai
  const farthestAI = otherAIsInSameArea[otherAIsInSameArea.length - 1] || ai
  // console.timeout('ai in area count', otherAIsInSameArea.length)
  // console.timeout('nearestAI', nearestAI.name, nearestAI.dist)
  possibleCoords.forEach(coord =>
    coord.nearestDist = dist(nearestAI, coord))

  // console.timeout({ maxValue })
  // console.timeout(possibleCoords)

  possibleCoords.sort((a, b) =>
    (b.score - a.score)
      || a.nearestDist - b.nearestDist
      || (pref[b.direction] - pref[a.direction]))

  if (!otherAIsInSameArea.length) return possibleCoords[0]

  // remove shitty moves (ratio lower than .33)
  const suckLessCoords = possibleCoords
    .filter(coord => coord.ratio > 0.33)

  // A position is risky if another ai can move on it next turn
  const otherAIsCoordsIndex = otherAIsCoords.map(toIndex)
  const unsafe = suckLessCoords
    .filter(coord => !otherAIsCoordsIndex.includes(coord.index))

  // TODO: aggressive mode
  // - Find nearest ai
  // - Rush toward him

  // TODO: passive mode
  // - Find nearest ai
  // - Avoid him

  // TODO: better check for "safe" spots:
  // - Check for tunnels
  // - find the end of the tunnel
  // - find if a ai can fill the gap before I can get out

  // TODO: better fill (if lone survivor)
  // - Check if move will block empty space
  // - fill space without being blocked

  // TODO: win condition
  // - Check if we can isolate a majority or blocks
  // - Then just do that and fill

  const safe = unsafe
    .filter(coord => getPossibleMovesFrom(coord)
      .filter(coord => toIndex(coord) !== ai.index).length > 1)

  return safe[0] || unsafe[0] || possibleCoords[0]
}
