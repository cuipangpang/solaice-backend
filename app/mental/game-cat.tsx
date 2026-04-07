/**
 * game-cat.tsx — 고양이 미니게임 5종
 * 게임별 30초 타이머, 탭 기반 인터랙션, 게임 종료 시 /mental/interaction POST
 *
 * 게임 목록 (gameKey 파라미터로 선택):
 *   laser_pointer — 이동하는 점을 탭해서 잡기
 *   feather_wand  — 흔들리는 깃털을 알맞은 타이밍에 탭
 *   paper_ball    — 공을 탭해서 통통 튀기기
 *   treat_hunt    — 4개 그릇 중 간식 숨긴 곳 찾기
 *   tunnel_play   — 달리는 고양이를 맞는 출구에서 탭
 */

import {
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { localCache } from '@/utils/storage'
import { mentalService } from '@/services/mentalService'

const GAME_DURATION = 30  // seconds

const GAME_META: Record<string, { title: string }> = {
  laser_pointer: { title: '레이저 포인터' },
  feather_wand:  { title: '깃털 완드' },
  paper_ball:    { title: '종이공' },
  treat_hunt:    { title: '간식 사냥' },
  tunnel_play:   { title: '터널 놀이' },
}

// ── 공통 훅: 타이머 ──────────────────────────────────────────────
function useGameTimer(onEnd: () => void) {
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION)
  const [started, setStarted]   = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(() => {
    setStarted(true)
    setTimeLeft(GAME_DURATION)
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(intervalRef.current!)
          onEnd()
          return 0
        }
        return t - 1
      })
    }, 1000)
  }, [onEnd])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  return { timeLeft, started, start }
}

// ── 1. 레이저 포인터 게임 ─────────────────────────────────────────
function LaserPointerGame({ onScore }: { onScore: (n: number) => void }) {
  const posX = useRef(new Animated.Value(100)).current
  const posY = useRef(new Animated.Value(100)).current
  const [dotPos, setDotPos] = useState({ x: 100, y: 100 })
  const animLoop = useRef<Animated.CompositeAnimation | null>(null)

  const moveDot = useCallback(() => {
    const nx = 30 + Math.random() * 240
    const ny = 100 + Math.random() * 200
    setDotPos({ x: nx, y: ny })
    animLoop.current = Animated.parallel([
      Animated.timing(posX, { toValue: nx, duration: 600, useNativeDriver: false }),
      Animated.timing(posY, { toValue: ny, duration: 600, useNativeDriver: false }),
    ])
    animLoop.current.start(() => {
      setTimeout(moveDot, 800 + Math.random() * 700)
    })
  }, [])

  useEffect(() => { moveDot() }, [])

  return (
    <View style={gs.arena}>
      <Pressable
        style={[gs.laserDotHit, { left: dotPos.x - 20, top: dotPos.y - 20 }]}
        onPress={() => onScore(1)}
        hitSlop={12}
      >
        <Text style={gs.laserDotEmoji}>🔴</Text>
      </Pressable>
      <Text style={gs.arenaHint}>빨간 점을 탭하세요!</Text>
    </View>
  )
}

// ── 2. 깃털 완드 게임 ────────────────────────────────────────────
function FeatherWandGame({ onScore }: { onScore: (n: number) => void }) {
  const swing = useRef(new Animated.Value(0)).current
  const [inZone, setInZone] = useState(false)

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    )
    loop.start()
    const listener = swing.addListener(({ value }) => setInZone(value > 0.4 && value < 0.6))
    return () => { loop.stop(); swing.removeListener(listener) }
  }, [])

  const tx = swing.interpolate({ inputRange: [0, 1], outputRange: [-110, 110] })

  return (
    <View style={gs.arena}>
      <View style={gs.zoneBar}>
        <View style={gs.sweetZone} />
      </View>
      <Animated.View style={[gs.feather, { transform: [{ translateX: tx }] }]}>
        <Text style={gs.featherEmoji}>🪶</Text>
      </Animated.View>
      <TouchableOpacity style={[gs.bigBtn, inZone && gs.bigBtnActive]} onPress={() => inZone && onScore(1)}>
        <Text style={gs.bigBtnText}>{inZone ? '지금 탭!' : '타이밍 맞춰 탭'}</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── 3. 종이공 게임 ───────────────────────────────────────────────
function PaperBallGame({ onScore }: { onScore: (n: number) => void }) {
  const bounce = useRef(new Animated.Value(0)).current
  const scale  = useRef(new Animated.Value(1)).current

  function tapBall() {
    onScore(1)
    Animated.sequence([
      Animated.parallel([
        Animated.timing(bounce, { toValue: -80, duration: 150, useNativeDriver: true }),
        Animated.timing(scale,  { toValue: 1.3,  duration: 100, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(bounce, { toValue: 0, friction: 4, useNativeDriver: true }),
        Animated.timing(scale,  { toValue: 1,   duration: 100, useNativeDriver: true }),
      ]),
    ]).start()
  }

  return (
    <View style={gs.arena}>
      <Text style={gs.arenaHint}>공을 계속 탭해봐요!</Text>
      <TouchableOpacity onPress={tapBall} activeOpacity={0.8}>
        <Animated.Text style={[gs.paperBallEmoji, { transform: [{ translateY: bounce }, { scale }] }]}>
          📰
        </Animated.Text>
      </TouchableOpacity>
    </View>
  )
}

// ── 4. 간식 사냥 게임 ────────────────────────────────────────────
function TreatHuntGame({ onScore }: { onScore: (n: number) => void }) {
  const [hiddenIdx, setHiddenIdx] = useState(() => Math.floor(Math.random() * 4))
  const [revealed, setRevealed]   = useState<number[]>([])

  function tapBowl(i: number) {
    if (revealed.includes(i)) return
    setRevealed((r) => [...r, i])
    if (i === hiddenIdx) {
      onScore(3)
      setTimeout(() => {
        setHiddenIdx(Math.floor(Math.random() * 4))
        setRevealed([])
      }, 800)
    }
  }

  return (
    <View style={gs.arena}>
      <Text style={gs.arenaHint}>간식이 숨겨진 그릇을 찾아요!</Text>
      <View style={gs.bowlGrid}>
        {[0, 1, 2, 3].map((i) => (
          <TouchableOpacity key={i} style={gs.bowl} onPress={() => tapBowl(i)}>
            <Text style={gs.bowlLabel}>
              {revealed.includes(i) ? (i === hiddenIdx ? '🍗' : '×') : '🥣'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

// ── 5. 터널 놀이 게임 ────────────────────────────────────────────
function TunnelPlayGame({ onScore }: { onScore: (n: number) => void }) {
  const catX = useRef(new Animated.Value(-40)).current
  const [exitIdx, setExitIdx] = useState(() => Math.floor(Math.random() * 3))

  const runCat = useCallback(() => {
    catX.setValue(-40)
    const target = exitIdx * 100
    Animated.timing(catX, { toValue: 340, duration: 1800, easing: Easing.linear, useNativeDriver: true }).start(() => {
      setExitIdx(Math.floor(Math.random() * 3))
      runCat()
    })
  }, [exitIdx])

  useEffect(() => { runCat() }, [exitIdx])

  function tapExit(i: number) {
    if (i === exitIdx) onScore(2)
  }

  return (
    <View style={gs.arena}>
      <Text style={gs.arenaHint}>고양이가 나올 출구를 탭해요!</Text>
      <Animated.Text style={[gs.catEmoji, { transform: [{ translateX: catX }] }]}>
        🐱
      </Animated.Text>
      <View style={gs.tunnelExits}>
        {[0, 1, 2].map((i) => (
          <TouchableOpacity key={i} style={[gs.exit, i === exitIdx && gs.exitActive]} onPress={() => tapExit(i)}>
            <Text style={gs.tunnelHoleEmoji}>🕳</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────
export default function GameCatScreen() {
  const { gameKey = 'laser_pointer' } = useLocalSearchParams<{ gameKey: string }>()
  const router = useRouter()
  const [score, setScore] = useState(0)
  const [done, setDone]   = useState(false)
  const [saving, setSaving] = useState(false)
  const scoreRef = useRef(0)

  const addScore = useCallback((n: number) => {
    if (done) return
    scoreRef.current += n
    setScore((s) => s + n)
  }, [done])

  const endGame = useCallback(() => setDone(true), [])
  const { timeLeft, started, start } = useGameTimer(endGame)

  async function saveResult() {
    setSaving(true)
    try {
      const petId = await localCache.getPetId()
      if (petId) {
        const result = await mentalService.logInteraction({
          pet_id: petId,
          interaction_type: 'game',
          game_key: gameKey,
          duration_seconds: GAME_DURATION,
          intensity: scoreRef.current >= 15 ? 'high' : scoreRef.current >= 7 ? 'medium' : 'low',
          game_score: scoreRef.current,
        })
        Alert.alert('게임 완료!', `점수: ${scoreRef.current}점\nXP +${result.xp_gained}  친밀도 +${result.intimacy_gained}`, [
          { text: '확인', onPress: () => router.back() },
        ])
      }
    } catch {
      Alert.alert('오류', '결과 저장에 실패했어요.')
    } finally {
      setSaving(false)
    }
  }

  const meta = GAME_META[gameKey] ?? GAME_META['laser_pointer']

  const GameComponent = {
    laser_pointer: LaserPointerGame,
    feather_wand:  FeatherWandGame,
    paper_ball:    PaperBallGame,
    treat_hunt:    TreatHuntGame,
    tunnel_play:   TunnelPlayGame,
  }[gameKey] ?? LaserPointerGame

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{meta.title}</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* HUD */}
      <View style={styles.hud}>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>시간</Text>
          <Text style={[styles.hudValue, timeLeft <= 5 && styles.hudValueWarn]}>{timeLeft}s</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>점수</Text>
          <Text style={styles.hudValue}>{score}</Text>
        </View>
      </View>

      {/* 게임 영역 */}
      {!started ? (
        <View style={styles.startWrap}>
          <View style={styles.startAccent} />
          <Text style={styles.startTitle}>{meta.title}</Text>
          <TouchableOpacity style={styles.startBtn} onPress={start}>
            <Text style={styles.startBtnText}>시작!</Text>
          </TouchableOpacity>
        </View>
      ) : done ? (
        <View style={styles.startWrap}>
          <Text style={styles.confetti}>🎉</Text>
          <Text style={styles.startTitle}>게임 종료!</Text>
          <Text style={styles.scoreText}>최종 점수: {score}점</Text>
          <TouchableOpacity style={[styles.startBtn, saving && { opacity: 0.5 }]} onPress={saveResult} disabled={saving}>
            <Text style={styles.startBtnText}>{saving ? '저장 중…' : '결과 저장'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <GameComponent onScore={addScore} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FAFCFF' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  headerTitle: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 17, color: '#2B3A55' },
  backArrow:   { fontSize: 22, color: '#2B3A55' },

  hud:         { flexDirection: 'row', justifyContent: 'center', gap: 40, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  hudItem:     { alignItems: 'center' },
  hudLabel:    { fontFamily: 'Pretendard-Regular', fontSize: 12, color: '#7A8DA3' },
  hudValue:    { fontFamily: 'RobotoMono_400Regular', fontSize: 26, color: '#2B3A55' },
  hudValueWarn:{ color: '#D32F2F' },

  startWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  startAccent: { width: 48, height: 6, borderRadius: 3, backgroundColor: '#BDE0FE' },
  startTitle:  { fontFamily: 'NotoSerifKR_700Bold', fontSize: 22, color: '#2B3A55' },
  scoreText:   { fontFamily: 'Pretendard-Regular', fontSize: 16, color: '#7A8DA3' },
  startBtn:    { backgroundColor: '#BDE0FE', borderRadius: 16, paddingHorizontal: 40, paddingVertical: 14, marginTop: 8 },
  startBtnText:{ fontFamily: 'Pretendard-SemiBold', fontSize: 18, color: '#2B3A55' },
  confetti:    { fontSize: 40 },
})

// 게임 컴포넌트 공용 스타일
const gs = StyleSheet.create({
  arena:      { flex: 1, backgroundColor: '#F4F8FF', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  arenaHint:  { position: 'absolute', top: 20, fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3' },

  // 레이저 포인터
  laserDotHit:   { position: 'absolute', width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  laserDotEmoji: { fontSize: 32 },

  // 깃털
  zoneBar:     { width: 280, height: 20, backgroundColor: '#E8EFF8', borderRadius: 10, overflow: 'hidden', position: 'absolute', top: 80 },
  sweetZone:   { position: 'absolute', left: '40%', width: '20%', height: '100%', backgroundColor: '#90CAF9', borderRadius: 10 },
  feather:      { marginBottom: 40 },
  featherEmoji: { fontSize: 52 },
  bigBtn:    { marginTop: 60, backgroundColor: '#F4F8FF', borderRadius: 16, paddingHorizontal: 32, paddingVertical: 16, borderWidth: 2, borderColor: '#E8EFF8' },
  bigBtnActive: { backgroundColor: '#BDE0FE', borderColor: '#BDE0FE' },
  bigBtnText:{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#2B3A55' },

  // 종이공
  paperBallEmoji: { fontSize: 72 },

  // 간식 사냥
  bowlGrid:  { flexDirection: 'row', flexWrap: 'wrap', width: 220, gap: 16, justifyContent: 'center', marginTop: 40 },
  bowl:      { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  bowlLabel: { fontSize: 28 },

  // 터널
  catEmoji:     { fontSize: 44, position: 'absolute', top: '40%' },
  tunnelHoleEmoji: { fontSize: 40 },
  tunnelExits: { position: 'absolute', bottom: 60, flexDirection: 'row', gap: 20 },
  exit:        { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' },
  exitActive:  { borderColor: '#BDE0FE', backgroundColor: '#EAF6FF' },
})
