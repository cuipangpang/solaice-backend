/**
 * game-dog.tsx — 강아지 미니게임 5종
 * game-cat.tsx와 동일한 구조 — 30초 타이머, 탭 기반 인터랙션
 *
 * 게임 목록 (gameKey 파라미터):
 *   fetch       — 날아오는 공을 탭해서 잡기
 *   tug_of_war  — 버튼을 빠르게 탭해서 줄을 당기기
 *   hide_seek   — 뒤집힌 카드 중 발바닥 찾기
 *   agility     — 장애물을 순서대로 탭
 *   frisbee     — 프리스비를 알맞은 높이에서 잡기
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

const GAME_DURATION = 30

const GAME_META: Record<string, { title: string }> = {
  fetch:      { title: '공 던지기' },
  tug_of_war: { title: '줄다리기' },
  hide_seek:  { title: '숨바꼭질' },
  agility:    { title: '어질리티' },
  frisbee:    { title: '프리스비' },
}

function useGameTimer(onEnd: () => void) {
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION)
  const [started, setStarted]   = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(() => {
    setStarted(true)
    setTimeLeft(GAME_DURATION)
    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(intervalRef.current!); onEnd(); return 0 }
        return t - 1
      })
    }, 1000)
  }, [onEnd])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])
  return { timeLeft, started, start }
}

// ── 1. 공 던지기 (Fetch) ──────────────────────────────────────────
function FetchGame({ onScore }: { onScore: (n: number) => void }) {
  const ballY = useRef(new Animated.Value(-50)).current
  const [catchable, setCatchable] = useState(false)

  const throwBall = useCallback(() => {
    ballY.setValue(-50)
    setCatchable(false)
    Animated.timing(ballY, { toValue: 400, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setCatchable(true)
      setTimeout(() => { setCatchable(false); throwBall() }, 600)
    })
  }, [])

  useEffect(() => { throwBall() }, [])

  return (
    <View style={gs.arena}>
      <Text style={gs.hint}>공이 내려올 때 탭해요!</Text>
      <Animated.View style={[gs.ball, { transform: [{ translateY: ballY }] }]}>
        <TouchableOpacity onPress={() => { if (catchable) { onScore(1); throwBall() } }} hitSlop={20}>
          <Text style={gs.ballEmoji}>⚾</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

// ── 2. 줄다리기 ───────────────────────────────────────────────────
function TugOfWarGame({ onScore }: { onScore: (n: number) => void }) {
  const [power, setPower] = useState(50)   // 0-100, 60 이상 = 점수

  function tap() {
    setPower((p) => Math.min(100, p + 7))
  }

  // setter 콜백 안에서 onScore를 직접 호출하면 렌더 중 다른 컴포넌트 setState 유발 →
  // useEffect로 power 값 변화를 감지해 안전하게 처리
  useEffect(() => {
    if (power >= 60) {
      onScore(1)
      setPower(0)
    }
  }, [power, onScore])

  // 서서히 줄어듦
  useEffect(() => {
    const id = setInterval(() => {
      setPower((p) => Math.max(0, p - 3))
    }, 400)
    return () => clearInterval(id)
  }, [])

  const barColor = power >= 60 ? '#90CAF9' : power >= 30 ? '#FFE29F' : '#FFB5A7'

  return (
    <View style={gs.arena}>
      <Text style={gs.hint}>빠르게 탭해서 줄을 당겨요!</Text>
      <Text style={gs.ropeEmoji}>🪢</Text>
      <View style={gs.powerBarBg}>
        <Animated.View style={[gs.powerBarFill, { width: `${power}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#7A8DA3', marginBottom: 16 }}>
        {power >= 60 ? '잘 당기고 있어요!' : '더 빠르게!'}
      </Text>
      <TouchableOpacity style={gs.tugBtn} onPress={tap}>
        <Text style={gs.tugBtnText}>당겨!</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── 3. 숨바꼭질 ──────────────────────────────────────────────────
function HideSeekGame({ onScore }: { onScore: (n: number) => void }) {
  const CARDS = 6
  const [hiddenIdx, setHiddenIdx] = useState(() => Math.floor(Math.random() * CARDS))
  const [flipped, setFlipped]     = useState<number[]>([])

  function tapCard(i: number) {
    if (flipped.includes(i)) return
    setFlipped((f) => [...f, i])
    if (i === hiddenIdx) {
      onScore(2)
      setTimeout(() => { setHiddenIdx(Math.floor(Math.random() * CARDS)); setFlipped([]) }, 700)
    }
  }

  return (
    <View style={gs.arena}>
      <Text style={gs.hint}>발바닥이 숨어있는 카드를 찾아요!</Text>
      <View style={gs.cardGrid}>
        {Array.from({ length: CARDS }).map((_, i) => (
          <TouchableOpacity key={i} style={gs.card} onPress={() => tapCard(i)}>
            <Text style={gs.cardLabel}>
              {flipped.includes(i) ? (i === hiddenIdx ? '발바닥' : '×') : '🃏'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

// ── 4. 어질리티 ──────────────────────────────────────────────────
const OBSTACLES = ['🏁', '🪣', '⛳', '🚧', '🎯']

function AgilityGame({ onScore }: { onScore: (n: number) => void }) {
  const [sequence] = useState(() => {
    const s = [...OBSTACLES].sort(() => Math.random() - 0.5)
    return s
  })
  const [current, setCurrent] = useState(0)

  function tapObstacle(i: number) {
    if (i === current) {
      onScore(2)
      const next = current + 1
      if (next >= OBSTACLES.length) {
        onScore(5)  // 보너스
        setCurrent(0)
      } else {
        setCurrent(next)
      }
    }
  }

  return (
    <View style={gs.arena}>
      <Text style={gs.hint}>순서대로 탭하세요: {sequence[current]}</Text>
      <View style={gs.obsGrid}>
        {sequence.map((obs, i) => (
          <TouchableOpacity
            key={i}
            style={[gs.obsBtn, i === current && gs.obsBtnActive]}
            onPress={() => tapObstacle(i)}
          >
            <Text style={gs.obsLabel}>{obs}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

// ── 5. 프리스비 ──────────────────────────────────────────────────
function FrisbeeGame({ onScore }: { onScore: (n: number) => void }) {
  const posY = useRef(new Animated.Value(0)).current
  const [catchY, setCatchY] = useState(0)
  const [catchable, setCatchable] = useState(false)

  const fly = useCallback(() => {
    const target = 60 + Math.random() * 200
    setCatchY(target)
    setCatchable(false)
    posY.setValue(0)
    Animated.sequence([
      Animated.timing(posY, { toValue: target, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(posY, { toValue: target, duration: 400, useNativeDriver: true }),
    ]).start(() => {
      setCatchable(true)
      setTimeout(() => { setCatchable(false); fly() }, 800)
    })
  }, [])

  useEffect(() => { fly() }, [])

  return (
    <View style={gs.arena}>
      <Text style={gs.hint}>프리스비가 멈출 때 탭해요!</Text>
      <View style={gs.frisbeeTrack}>
        <Animated.View style={[gs.frisbeeWrap, { transform: [{ translateY: posY }] }]}>
          <TouchableOpacity onPress={() => { if (catchable) { onScore(2); fly() } }} hitSlop={16}>
            <Text style={[gs.frisbeeEmoji, catchable && gs.frisbeeEmojiActive]}>🥏</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────
export default function GameDogScreen() {
  const { gameKey = 'fetch' } = useLocalSearchParams<{ gameKey: string }>()
  const router  = useRouter()
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

  const meta = GAME_META[gameKey] ?? GAME_META['fetch']
  const GameComponent = {
    fetch:      FetchGame,
    tug_of_war: TugOfWarGame,
    hide_seek:  HideSeekGame,
    agility:    AgilityGame,
    frisbee:    FrisbeeGame,
  }[gameKey] ?? FetchGame

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{meta.title}</Text>
        <View style={{ width: 32 }} />
      </View>

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

const gs = StyleSheet.create({
  arena:   { flex: 1, backgroundColor: '#F4F8FF', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  hint:    { position: 'absolute', top: 20, fontFamily: 'Pretendard-Regular', fontSize: 14, color: '#7A8DA3' },

  // 공 던지기
  ball:      { position: 'absolute', top: 0 },
  ballEmoji: { fontSize: 48 },

  // 줄다리기
  ropeEmoji:    { fontSize: 48, marginBottom: 24 },
  powerBarBg:   { width: 260, height: 22, backgroundColor: '#E8EFF8', borderRadius: 11, overflow: 'hidden', marginBottom: 12 },
  powerBarFill: { height: '100%', borderRadius: 11 },
  tugBtn:       { backgroundColor: '#BDE0FE', borderRadius: 20, paddingHorizontal: 48, paddingVertical: 18 },
  tugBtnText:   { fontFamily: 'Pretendard-SemiBold', fontSize: 20, color: '#2B3A55' },

  // 숨바꼭질
  cardGrid:  { flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 12, justifyContent: 'center', marginTop: 40 },
  card:      { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardLabel: { fontSize: 26 },

  // 어질리티
  obsGrid:     { flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 14, justifyContent: 'center', marginTop: 40 },
  obsBtn:      { width: 70, height: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, borderColor: 'transparent', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  obsBtnActive:{ borderColor: '#BDE0FE', backgroundColor: '#EAF6FF' },
  obsLabel:    { fontSize: 26 },

  // 프리스비
  frisbeeTrack:      { height: 300, alignItems: 'center', justifyContent: 'flex-start' },
  frisbeeWrap:       {},
  frisbeeEmoji:      { fontSize: 52, opacity: 0.5 },
  frisbeeEmojiActive:{ opacity: 1 },
})
