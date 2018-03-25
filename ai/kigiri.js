const SIZE = 100
const MAX = SIZE * SIZE

/// WEBWORKER BOOTSTRAP CODE
addEventListener('message', self.init = initEvent => {
  const { seed, id } = JSON.parse(initEvent.data)
  const isOwnPlayer = p => p.name === id
  const MAP = new Uint8Array(MAX)
  const addToMap = ({ x, y }) => MAP[x * SIZE + y] = 1
  const isFree = ({ x, y }) => MAP[x * SIZE + y] === 0
  const isOccupied = ({ x, y }) => MAP[x * SIZE + y] === 1

  let _seed = seed // Use seeded random for replayable games
  const _m = 0x80000000
  Math.random = () => (_seed = (1103515245 * _seed + 12345) % _m) / (_m - 1)
  const toLog = []
  const logEach = () => {
    for (const l of toLog) { console.log(...l) }
    toLog.length = 0
  }
  let t
  console.timeout = id === 'kigiri'
    ? (...a) => (toLog.push(a), clearTimeout(t), t = setTimeout(logEach, 100))
    : () => {}
  removeEventListener('message', self.init)
  addEventListener('message', ({ data }) => {
    toLog.length = 0
    const players = JSON.parse(data)
    const player = players.find(isOwnPlayer)
    players.forEach(addToMap)

    postMessage(JSON.stringify(update({ MAP, isFree, isOccupied, players, player })))
  })
  postMessage('loaded')
})

/// AI CODE
const inBounds = n => n < SIZE && n >= 0
const isInBounds = ({ x, y }) => inBounds(x) && inBounds(y)
const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)]

const pref = [ 1, 2, 0, -1 ]
const genCountMap = (MAP, playerCoords, otherPlayersCoords) => {
  let i, areaIndex
  i = -1
  const scoreMap = new Uint16Array(MAX)
  const areas = new Map()
  while (++i < MAX) {
    if (MAP[i]) {
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
  const playerAreas = new Set
  for (const coord of playerCoords) {
    const area = areas.get(scoreMap[coord.index])
    if (!area) continue
    area.keep = true
    coord.score = area.total
    coord.areaIndex = area.i
    playerAreas.add(area)
  }

  // Fill the empty spots so they are ignored later on
  i = -1
  while (++i < MAX) {
    if (MAP[i]) continue
    const area = areas.get(scoreMap[i])
    area && !area.keep && (MAP[i] = 2)
  }

  for (const coord of otherPlayersCoords) {
    const area = areas.get(scoreMap[coord.index])
    if (!area) continue
    coord.areaIndex = area.i
  }
  return [ ...playerAreas ]
}

const flatten = (a, b) => a.concat(b)
const toIndex = ({ x, y }) => x * SIZE + y
const getPossibleMovesFrom = ({ x, y }, MAP) => [
  { x, y: y + 1 },
  { x, y: y - 1 },
  { x: x + 1, y },
  { x: x - 1, y },
].filter(isInBounds).map(toIndex).filter(index => MAP[index] === 0)
const addIndex = p => p.index = toIndex(p)
const update = ({ isFree, players, player, MAP }) => {
  const possibleCoords = player.coords
    .filter(isInBounds)
    .filter(isFree)

  const otherPlayers = players.filter(p => p.name !== player.name)
  const otherPlayersCoords = otherPlayers
    .map(p => p.coords)
    .reduce(flatten, [])
    .filter(isInBounds)
    .filter(isFree)

  players.forEach(addIndex)
  possibleCoords.forEach(addIndex)
  otherPlayersCoords.forEach(addIndex)

  const playerAreas = genCountMap(MAP, possibleCoords, otherPlayersCoords)
  const playerAreasIndex = playerAreas.map(pa => pa.i)
  const playerAreasValues = playerAreas.map(pa => pa.total)
  const maxValue = playerAreasValues.reduce((a, b) => Math.max(a, b), 0)

  possibleCoords.forEach(coord => coord.ratio = coord.score / maxValue)

  const otherPlayersInSameArea = otherPlayers
    .filter(p => p.coords.some(c => playerAreasIndex.includes(c.areaIndex)))

  possibleCoords.sort((a, b) =>
    (b.score - a.score) || (pref[b.direction] - pref[a.direction]))

  if (!otherPlayersInSameArea.length) return possibleCoords[0]

  // remove shitty moves (ratio lower than .33)
  const suckLessCoords = possibleCoords
    .filter(coord => coord.ratio > 0.33)

  // A position is risky if another player can move on it next turn
  const otherPlayersCoordsIndex = otherPlayersCoords.map(toIndex)
  const unsafe = suckLessCoords
    .filter(coord => !otherPlayersCoordsIndex.includes(coord.index))

  // TODO: better check for "safe" spots:
  // - Check for tunnels
  // - find the end of the tunnel
  // - find if a player can fill the gap before I can get out
  const safe = unsafe
    .filter(coord => getPossibleMovesFrom(coord, MAP)
      .filter(coord => toIndex(coord) !== player.index).length > 1)

  return safe[0] || unsafe[0] || possibleCoords[0]
}
