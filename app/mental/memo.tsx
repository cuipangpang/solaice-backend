/**
 * memo.tsx — 반려동물 메모장
 * 채팅 버블 스타일의 메모 입력/열람 화면
 */

import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'

// ── 타입 ──────────────────────────────────────────────────────

interface MemoItem {
  id: string
  text: string
  createdAt: Date
  type: 'user' | 'done'   // user = 오른쪽 보라, done = 왼쪽 흰색
}

// ── 헬퍼 ──────────────────────────────────────────────────────

function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function formatDateLabel(date: Date): string {
  const today = new Date()
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth()    === today.getMonth()    &&
    date.getDate()     === today.getDate()
  if (isToday) return '오늘'
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

function needsDateLabel(items: MemoItem[], index: number): boolean {
  if (index === 0) return true
  const prev = items[index - 1].createdAt
  const curr = items[index].createdAt
  return (
    prev.getFullYear() !== curr.getFullYear() ||
    prev.getMonth()    !== curr.getMonth()    ||
    prev.getDate()     !== curr.getDate()
  )
}

// ── 버블 컴포넌트 ─────────────────────────────────────────────

function MemoRow({
  item,
  showDateLabel,
}: {
  item: MemoItem
  showDateLabel: boolean
}) {
  const isUser = item.type === 'user'

  return (
    <>
      {showDateLabel && (
        <View style={s.dateLabelWrap}>
          <View style={s.dateLabel}>
            <Text style={s.dateLabelText}>{formatDateLabel(item.createdAt)}</Text>
          </View>
        </View>
      )}
      <View style={isUser ? s.rowRight : s.rowLeft}>
        <View style={isUser ? s.bubbleUser : s.bubbleDone}>
          <Text style={isUser ? s.bubbleUserText : s.bubbleDoneText}>{item.text}</Text>
        </View>
        <Text style={isUser ? s.timestampRight : s.timestampLeft}>
          {formatTime(item.createdAt)}
        </Text>
      </View>
    </>
  )
}

// ── 메인 ──────────────────────────────────────────────────────

export default function MemoScreen() {
  const router = useRouter()
  const flatRef = useRef<FlatList<MemoItem>>(null)
  const [items, setItems] = useState<MemoItem[]>([])
  const [input, setInput] = useState('')

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    const newItem: MemoItem = {
      id: Date.now().toString(),
      text,
      createdAt: new Date(),
      type: 'user',
    }
    setItems((prev) => [...prev, newItem])
    setInput('')
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80)
  }, [input])

  const renderItem = useCallback(
    ({ item, index }: { item: MemoItem; index: number }) => (
      <MemoRow
        item={item}
        showDateLabel={needsDateLabel(items, index)}
      />
    ),
    [items],
  )

  return (
    <SafeAreaView style={s.safe}>
      {/* 헤더 */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={s.backBtn}
        >
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>메모</Text>
        <View style={s.headerRight} />
      </View>

      {/* 메모 목록 + 입력 */}
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatRef}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={s.list}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={s.emptyText}>메모를 입력해 보세요 ✏️</Text>
            </View>
          }
        />

        {/* 입력 영역 */}
        <View style={s.inputArea}>
          <TextInput
            style={s.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="메모를 입력하세요..."
            placeholderTextColor="#AAAAAA"
            multiline
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[s.sendBtn, !input.trim() && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim()}
            activeOpacity={0.75}
          >
            <Text style={s.sendBtnIcon}>▶</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// ── 스타일 ────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: '#F5F5FA' },
  flex:  { flex: 1 },

  // 헤더
  header: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor:   '#F5F5FA',
    borderBottomWidth: 1,
    borderBottomColor: '#EFEFEF',
  },
  backBtn:     { width: 36, alignItems: 'flex-start' },
  backArrow:   { fontSize: 22, color: '#2B3A55' },
  headerTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   17,
    color:      '#2B3A55',
    fontWeight: '700',
  },
  headerRight: { width: 36 },

  // 목록
  list:        { flex: 1 },
  listContent: { paddingTop: 12, paddingBottom: 16 },

  // 빈 상태
  emptyWrap: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     80,
  },
  emptyText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   15,
    color:      '#AAAAAA',
  },

  // 날짜 구분선
  dateLabelWrap: {
    alignItems:     'center',
    marginVertical: 12,
  },
  dateLabel: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius:    12,
    paddingHorizontal: 12,
    paddingVertical:    4,
  },
  dateLabelText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   12,
    color:      '#666666',
  },

  // 행 정렬
  rowRight: {
    alignItems:  'flex-end',
    marginRight: 16,
    marginBottom: 8,
  },
  rowLeft: {
    alignItems:  'flex-start',
    marginLeft:  16,
    marginBottom: 8,
  },

  // 오른쪽 버블 (사용자)
  bubbleUser: {
    backgroundColor:       '#C8B8E8',
    borderRadius:          18,
    borderBottomRightRadius: 4,
    paddingVertical:         12,
    paddingHorizontal:       16,
    maxWidth:               '75%',
  },
  bubbleUserText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   15,
    color:      '#2B1F40',
    lineHeight: 22,
  },

  // 왼쪽 버블 (완료/시스템)
  bubbleDone: {
    backgroundColor:      '#FFFFFF',
    borderRadius:         18,
    borderBottomLeftRadius: 4,
    paddingVertical:        12,
    paddingHorizontal:      16,
    maxWidth:              '75%',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.06,
    shadowRadius:    4,
    elevation:       1,
  },
  bubbleDoneText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   15,
    color:      '#444444',
    lineHeight: 22,
  },

  // 타임스탬프
  timestampRight: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   11,
    color:      '#999999',
    marginTop:   4,
  },
  timestampLeft: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   11,
    color:      '#999999',
    marginTop:   4,
  },

  // 입력 영역
  inputArea: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth:  1,
    borderTopColor:  '#EFEFEF',
    paddingHorizontal: 16,
    paddingVertical:    8,
  },
  textInput: {
    flex:             1,
    backgroundColor:  '#F0F0F5',
    borderRadius:     20,
    paddingHorizontal: 16,
    paddingVertical:   10,
    fontFamily:       'Pretendard-Regular',
    fontSize:         15,
    color:            '#2B3A55',
    maxHeight:        120,
  },
  sendBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: '#C8B8E8',
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      8,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnIcon: {
    fontSize: 16,
    color:    '#FFFFFF',
  },
})
