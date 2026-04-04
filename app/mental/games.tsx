import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { localCache } from '@/utils/storage'
import { petService } from '@/services/petService'
import { useEffect, useState } from 'react'

interface Game {
  key: string
  emoji: string
  title: string
  desc: string
  duration: string
  xp: number
  species: 'cat' | 'dog' | 'both'
}

const ALL_GAMES: Game[] = [
  // 고양이 게임
  { key: 'laser_pointer', emoji: '🔴', title: '레이저 포인터',   desc: '빨간 점을 잡아봐요!',        duration: '30초', xp: 30, species: 'cat' },
  { key: 'feather_wand',  emoji: '🪶', title: '깃털 완드',       desc: '흔들리는 깃털을 노려봐요',     duration: '30초', xp: 25, species: 'cat' },
  { key: 'paper_ball',    emoji: '📰', title: '종이공',           desc: '통통 튀는 공을 쳐봐요',       duration: '30초', xp: 20, species: 'cat' },
  { key: 'treat_hunt',    emoji: '🍗', title: '간식 사냥',        desc: '숨겨진 간식을 찾아봐요',       duration: '30초', xp: 35, species: 'cat' },
  { key: 'tunnel_play',   emoji: '🕳', title: '터널 놀이',        desc: '터널을 통과해봐요',            duration: '30초', xp: 25, species: 'cat' },
  // 강아지 게임
  { key: 'fetch',         emoji: '⚾', title: '공 던지기',        desc: '공을 잡아와요!',              duration: '30초', xp: 30, species: 'dog' },
  { key: 'tug_of_war',    emoji: '🪢', title: '줄다리기',         desc: '힘껏 당겨봐요',               duration: '30초', xp: 35, species: 'dog' },
  { key: 'hide_seek',     emoji: '🙈', title: '숨바꼭질',         desc: '발바닥을 찾아봐요',            duration: '30초', xp: 25, species: 'dog' },
  { key: 'agility',       emoji: '🏃', title: '어질리티',         desc: '장애물을 순서대로 통과해요',   duration: '30초', xp: 40, species: 'dog' },
  { key: 'frisbee',       emoji: '🥏', title: '프리스비',         desc: '프리스비를 잡아봐요',          duration: '30초', xp: 30, species: 'dog' },
]

export default function GamesScreen() {
  const router = useRouter()
  const [species, setSpecies] = useState<'cat' | 'dog' | null>(null)
  const [tab, setTab] = useState<'cat' | 'dog'>('cat')

  useEffect(() => {
    localCache.getPetId().then(async (id) => {
      if (!id) return
      try {
        const pet = await petService.getPet(id)
        const s = pet.species === 'dog' ? 'dog' : 'cat'
        setSpecies(s)
        setTab(s)
      } catch {}
    })
  }, [])

  const games = ALL_GAMES.filter((g) => g.species === tab)

  function handlePlay(game: Game) {
    if (tab === 'cat') {
      router.push({ pathname: '/mental/game-cat', params: { gameKey: game.key } })
    } else {
      router.push({ pathname: '/mental/game-dog', params: { gameKey: game.key } })
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>게임 놀기</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 탭 */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'cat' && styles.tabActive]} onPress={() => setTab('cat')}>
          <Text style={[styles.tabText, tab === 'cat' && styles.tabTextActive]}>🐱 고양이</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'dog' && styles.tabActive]} onPress={() => setTab('dog')}>
          <Text style={[styles.tabText, tab === 'dog' && styles.tabTextActive]}>🐶 강아지</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {games.map((game) => (
          <TouchableOpacity key={game.key} style={styles.gameCard} activeOpacity={0.85} onPress={() => handlePlay(game)}>
            <Text style={styles.gameEmoji}>{game.emoji}</Text>
            <View style={styles.gameInfo}>
              <Text style={styles.gameTitle}>{game.title}</Text>
              <Text style={styles.gameDesc}>{game.desc}</Text>
              <View style={styles.gameMeta}>
                <Text style={styles.gameDuration}>⏱ {game.duration}</Text>
                <Text style={styles.gameXp}>+{game.xp} XP</Text>
              </View>
            </View>
            <Text style={styles.playArrow}>▶</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#FAFCFF' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E8EFF8' },
  headerTitle:{ fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55' },
  backArrow:  { fontSize: 22, color: '#2B3A55' },
  scroll:     { padding: 20, paddingBottom: 48 },

  tabRow:       { flexDirection: 'row', margin: 16, backgroundColor: '#F4F8FF', borderRadius: 14, padding: 4 },
  tab:          { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 11 },
  tabActive:    { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  tabText:      { fontFamily: 'Pretendard-Medium', fontSize: 14, color: '#7A8DA3' },
  tabTextActive:{ color: '#2B3A55', fontFamily: 'Pretendard-SemiBold' },

  gameCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  gameEmoji:  { fontSize: 36, marginRight: 14 },
  gameInfo:   { flex: 1 },
  gameTitle:  { fontFamily: 'Pretendard-SemiBold', fontSize: 16, color: '#2B3A55', marginBottom: 3 },
  gameDesc:   { fontFamily: 'Pretendard-Regular', fontSize: 13, color: '#7A8DA3', marginBottom: 6 },
  gameMeta:   { flexDirection: 'row', gap: 10 },
  gameDuration:{ fontFamily: 'RobotoMono_400Regular', fontSize: 12, color: '#7A8DA3' },
  gameXp:     { fontFamily: 'Pretendard-SemiBold', fontSize: 12, color: '#5BB3FF' },
  playArrow:  { fontSize: 18, color: '#BDE0FE', marginLeft: 8 },
})
