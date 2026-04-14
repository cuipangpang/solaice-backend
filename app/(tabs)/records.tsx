import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { healthRecordService, type HealthRecord, type HealthStats } from '@/services/healthRecordService'
import { petService, type PetProfile } from '@/services/petService'
import { vaccineService, type VaccineRecord } from '@/services/vaccineService'
import { healthEventService, type HealthEvent, type EventType } from '@/services/healthEventService'
import { localCache } from '@/utils/storage'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ── 常量 ───────────────────────────────────────────────────────

type ScreenState = 'loading' | 'error' | 'no-pet' | 'loaded'
type SpeciesKey = 'cat' | 'dog' | 'other'

const SPECIES_INFO: Record<SpeciesKey, { label: string; icon: string }> = {
  cat:   { label: '고양이', icon: '고' },
  dog:   { label: '강아지', icon: '강' },
  other: { label: '기타',   icon: '기' },
}

const URGENCY_LABEL: Record<string, string> = {
  normal: '정상', caution: '주의', visit: '병원', emergency: '긴급',
}
const URGENCY_BG: Record<string, string> = {
  normal: '#90CAF9', caution: '#FFE29F', visit: '#FFB5A7', emergency: '#D32F2F',
}
const URGENCY_TEXT: Record<string, string> = {
  normal: '#1A3A5C', caution: '#5A4000', visit: '#5C1A0F', emergency: '#FFFFFF',
}

const EVENT_EMOJI: Record<EventType, string> = {
  vaccine:  '💉',
  birthday: '🎂',
  grooming: '✂️',
  hospital: '🏥',
}

const EVENT_LABEL: Record<EventType, string> = {
  vaccine:  '예방접종',
  birthday: '생일',
  grooming: '미용',
  hospital: '병원',
}

const ALL_EVENT_TYPES: EventType[] = ['vaccine', 'birthday', 'grooming', 'hospital']

const MODULE_LABELS: Record<string, string> = {
  skin:       '피부',
  oral:       '구강',
  eye:        '눈',
  ear:        '귀',
  excrement:  '대변',
  vomit:      '구토물',
  '皮肤':     '피부',
  '口腔':     '구강',
  '眼睛':     '눈',
  '耳朵':     '귀',
  '粪便':     '대변',
  '呕吐物':   '구토물',
  chat:       'AI 상담',
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const today  = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime())
}

/** Date → "YYYY-MM-DD" (백엔드 전송용) */
function toApiDate(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Date → "YYYY.MM.DD" (화면 표시용) */
function toDisplayDate(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${dd}`
}

/** 오늘 + 1년 */
function defaultNextDate(): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d
}

// ── 主页面 ─────────────────────────────────────────────────────

export default function RecordsScreen() {
  const [state,   setState]   = useState<ScreenState>('loading')
  const [pet,     setPet]     = useState<PetProfile | null>(null)
  const [records, setRecords] = useState<HealthRecord[]>([])
  const [vaccines, setVaccines] = useState<VaccineRecord[]>([])
  const [stats,   setStats]   = useState<HealthStats | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // ── 건강 이벤트 상태 ──────────────────────────────────────────
  const [healthEvents,         setHealthEvents]         = useState<HealthEvent[]>([])
  const [showEventModal,       setShowEventModal]       = useState(false)
  const [newEventType,         setNewEventType]         = useState<EventType>('vaccine')
  const [newEventDate,         setNewEventDate]         = useState<Date>(new Date())
  const [showEventDatePicker,  setShowEventDatePicker]  = useState(false)
  const [newEventNextDate,     setNewEventNextDate]     = useState<Date | null>(null)
  const [showNextDatePicker,   setShowNextDatePicker]   = useState(false)
  const [newEventNote,         setNewEventNote]         = useState('')
  const [eventSaving,          setEventSaving]          = useState(false)

  // ── 表单状态 ─────────────────────────────────────────────────
  const [formName,    setFormName]    = useState('')
  const [formSpecies, setFormSpecies] = useState<SpeciesKey>('cat')
  const [formBreed,   setFormBreed]   = useState('')
  const [formAge,     setFormAge]     = useState('')
  const [formSaving,  setFormSaving]  = useState(false)

  // ── 数据加载 ─────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      loadAll()
    }, []),
  )

  async function loadAll() {
    setState('loading')
    try {
      const petId = await localCache.getPetId()
      if (!petId) {
        setState('no-pet')
        return
      }

      const [petData, recordsData, vaccinesData, statsData, eventsData] = await Promise.all([
        petService.getPet(petId),
        healthRecordService.getHealthRecords(petId),
        vaccineService.getVaccineRecords(petId),
        healthRecordService.getHealthStats(petId),
        healthEventService.getHealthEvents(petId).catch(() => [] as HealthEvent[]),
      ])

      setPet(petData)
      setAvatarUrl(petData.avatar_url)
      setRecords(recordsData)
      setVaccines(vaccinesData)
      setStats(statsData)
      setHealthEvents(eventsData)
      setState('loaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('不存在') || msg.includes('NOT_FOUND') || msg.includes('HTTP 404')) {
        await localCache.clearPetId()
        setState('no-pet')
      } else {
        setState('error')
      }
    }
  }

  // ── 头像上传 ──────────────────────────────────────────────────

  async function pickAndUploadAvatar() {
    if (!pet) return
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한이 필요해요')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })

    if (result.canceled) return

    const asset = result.assets[0]
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', {
        uri: asset.uri,
        type: asset.mimeType ?? 'image/jpeg',
        name: 'avatar.jpg',
      } as any)

      const response = await fetch(
        `${API_BASE}/upload/avatar/${pet.id}`,
        {
          method: 'POST',
          body: formData,
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      )

      if (!response.ok) throw new Error('업로드 실패')

      const data = await response.json()
      await petService.updateAvatar(pet.id, data.avatar_url)
      setAvatarUrl(data.avatar_url)
      Alert.alert('완료', '프로필 사진이 업데이트되었어요 🐾')
    } catch {
      Alert.alert('오류', '사진 업로드에 실패했어요. 다시 시도해 주세요.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  // ── 档案编辑 Modal ────────────────────────────────────────────

  function openEditModal() {
    setFormName(pet?.name ?? '')
    setFormSpecies(((pet?.species as SpeciesKey) in SPECIES_INFO ? pet!.species as SpeciesKey : 'cat') ?? 'cat')
    setFormBreed(pet?.breed ?? '')
    setFormAge(pet?.age_years != null ? String(pet.age_years) : '')
    setShowModal(true)
  }

  async function handleSavePet() {
    if (!formName.trim()) {
      Alert.alert('반려동물 이름을 입력해주세요')
      return
    }
    setFormSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        species: formSpecies,
        ...(formBreed.trim()             && { breed:     formBreed.trim() }),
        ...(formAge && !isNaN(parseFloat(formAge)) && { age_years: parseFloat(formAge) }),
      }
      const savedPet = pet
        ? await petService.updatePet(pet.id, payload)
        : await petService.createPet(payload)

      await localCache.savePetId(savedPet.id)
      setShowModal(false)
      await loadAll()
    } catch (err) {
      Alert.alert('저장 실패', err instanceof Error ? err.message : '잠시 후 다시 시도해주세요')
    } finally {
      setFormSaving(false)
    }
  }

  // ── 删除检测记录 ──────────────────────────────────────────────

  function confirmDeleteRecord(record: HealthRecord) {
    Alert.alert(
      '검사 기록 삭제',
      `이 ${record.module_label} 검사 기록을 삭제하시겠습니까? 삭제 후 복원할 수 없습니다`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => handleDeleteRecord(record.id),
        },
      ],
    )
  }

  async function handleDeleteRecord(id: string) {
    try {
      await healthRecordService.deleteHealthRecord(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
    } catch {
      Alert.alert('삭제 실패', '네트워크를 확인 후 다시 시도해주세요')
    }
  }

  // ── 건강 이벤트 ──────────────────────────────────────────────

  function openEventModal() {
    setNewEventType('vaccine')
    setNewEventDate(new Date())
    setShowEventDatePicker(false)
    setNewEventNextDate(defaultNextDate())
    setShowNextDatePicker(false)
    setNewEventNote('')
    setShowEventModal(true)
  }

  async function handleSaveEvent() {
    const petId = await localCache.getPetId()
    if (!petId) {
      Alert.alert('오류', '반려동물 정보를 불러올 수 없습니다. 다시 시도해 주세요.')
      return
    }

    const formData = {
      event_type: newEventType,
      event_date: toApiDate(newEventDate),
      next_date:  newEventNextDate ? toApiDate(newEventNextDate) : null,
      note:       newEventNote.trim() || null,
    }
    console.log('저장 시작', formData)

    setEventSaving(true)
    try {
      const created = await healthEventService.createHealthEvent(petId, formData)
      setHealthEvents((prev) => [created, ...prev])
      setShowEventModal(false)
    } catch (err) {
      console.log('저장 실패', err)
      Alert.alert('오류', err instanceof Error ? err.message : '저장에 실패했어요')
    } finally {
      setEventSaving(false)
    }
  }

  async function handleDeleteEvent(event: HealthEvent) {
    Alert.alert(
      '기록 삭제',
      `이 ${EVENT_LABEL[event.event_type]} 기록을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            const petId = await localCache.getPetId()
            if (!petId) return
            try {
              await healthEventService.deleteHealthEvent(petId, event.id)
              setHealthEvents((prev) => prev.filter((e) => e.id !== event.id))
            } catch {
              Alert.alert('삭제 실패', '네트워크를 확인 후 다시 시도해주세요')
            }
          },
        },
      ],
    )
  }

  // ── 生成就医报告 ──────────────────────────────────────────────

  async function handleGenerateReport() {
    const petId = await localCache.getPetId()
    if (!petId) {
      Alert.alert('반려동물 프로필을 찾을 수 없습니다', '먼저 반려동물 프로필을 만들어주세요')
      return
    }
    const now = new Date()
    const endDate = now.toISOString().split('T')[0]
    const start = new Date(now)
    start.setMonth(start.getMonth() - 3)
    const startDate = start.toISOString().split('T')[0]
    const url = `${API_BASE}/reports/generate?pet_id=${petId}&start_date=${startDate}&end_date=${endDate}`
    Linking.openURL(url)
  }

  // ── Loading / Error ───────────────────────────────────────────

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#BDE0FE" />
          <Text style={styles.loadingText}>로딩 중…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>로드 실패, 네트워크 연결을 확인해주세요</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadAll}>
            <Text style={styles.retryBtnText}>탭하여 재시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── 主内容 ───────────────────────────────────────────────────

  // ── 다가오는 일정 계산 (next_date ≤ 30일 이내) ──────────────
  const today30 = new Date()
  today30.setHours(0, 0, 0, 0)
  const limit30 = new Date(today30)
  limit30.setDate(limit30.getDate() + 30)

  const upcomingEvents = healthEvents
    .filter((e) => {
      if (!e.next_date) return false
      const nd = new Date(e.next_date)
      nd.setHours(0, 0, 0, 0)
      return nd >= today30 && nd <= limit30
    })
    .sort((a, b) => new Date(a.next_date!).getTime() - new Date(b.next_date!).getTime())

  const speciesKey = (pet?.species as SpeciesKey) in SPECIES_INFO
    ? (pet!.species as SpeciesKey)
    : 'other'

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 页面标题 ──────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>기록</Text>
          {stats && stats.total > 0 && (
            <View style={styles.statsBadge}>
              <Text style={styles.statsBadgeText}>{stats.total}회 검사</Text>
            </View>
          )}
        </View>

        {state === 'no-pet' ? (
          /* ── 无档案引导 ─────────────────────────────────── */
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>반려동물 프로필이 없습니다</Text>
            <Text style={styles.emptySub}>프로필을 만들면 검사 결과가 건강 타임라인에 자동으로 저장됩니다</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={openEditModal}>
              <Text style={styles.primaryBtnText}>반려동물 프로필 만들기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── 宠物信息卡 ──────────────────────────────── */}
            <View style={styles.petCard}>
              <View style={styles.petCardLeft}>
                <TouchableOpacity
                  onPress={pickAndUploadAvatar}
                  disabled={uploadingAvatar}
                  activeOpacity={0.8}
                  style={styles.petIconWrap}
                >
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={{ width: 52, height: 52, borderRadius: 26 }}
                    />
                  ) : (
                    <Text style={styles.petSpeciesIcon}>{SPECIES_INFO[speciesKey].icon[0]}</Text>
                  )}
                  <View style={styles.avatarEditBadge}>
                    {uploadingAvatar
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.avatarEditIcon}>✎</Text>
                    }
                  </View>
                </TouchableOpacity>
                <View style={styles.petCardInfo}>
                  <Text style={styles.petName}>{pet!.name}</Text>
                  <Text style={styles.petMeta}>
                    {SPECIES_INFO[speciesKey].label}
                    {pet!.breed    ? `  ·  ${pet!.breed}`        : ''}
                    {pet!.age_years != null ? `  ·  ${pet!.age_years}살` : ''}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.editBtn} onPress={openEditModal}>
                <Text style={styles.editBtnText}>편집</Text>
              </TouchableOpacity>
            </View>

            {/* ── 数据统计行 ──────────────────────────────── */}
            {stats && (
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats.total}</Text>
                  <Text style={styles.statLabel}>검사 횟수</Text>
                </View>
                <View style={[styles.statCard, styles.statCardMid]}>
                  <Text style={styles.statValue}>
                    {stats.last_check_at
                      ? new Date(stats.last_check_at).toLocaleDateString('ko-KR', {
                          month: 'numeric', day: 'numeric',
                        })
                      : '—'}
                  </Text>
                  <Text style={styles.statLabel}>최근 검사</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{vaccines.length}</Text>
                  <Text style={styles.statLabel}>백신 기록</Text>
                </View>
              </View>
            )}

            {/* ── 다가오는 일정 ─────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>다가오는 일정</Text>
              {upcomingEvents.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>다가오는 일정이 없습니다</Text>
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.upcomingScroll}
                >
                  {upcomingEvents.map((ev) => {
                    const days = daysUntil(ev.next_date!)
                    return (
                      <View key={ev.id} style={styles.upcomingCard}>
                        <Text style={styles.upcomingEmoji}>
                          {EVENT_EMOJI[ev.event_type as EventType] ?? '📅'}
                        </Text>
                        <Text style={styles.upcomingLabel}>
                          {EVENT_LABEL[ev.event_type as EventType] ?? ev.event_type}
                        </Text>
                        <Text style={styles.upcomingDays}>
                          {days === 0 ? 'D-Day' : `D-${days}`}
                        </Text>
                        <Text style={styles.upcomingDate}>
                          {new Date(ev.next_date!).toLocaleDateString('ko-KR', {
                            month: 'numeric',
                            day:   'numeric',
                          })}
                        </Text>
                      </View>
                    )
                  })}
                </ScrollView>
              )}
            </View>

            {/* ── 기록 추가 버튼 ────────────────────────────── */}
            <TouchableOpacity
              style={styles.addEventBtn}
              onPress={openEventModal}
              activeOpacity={0.8}
            >
              <Text style={styles.addEventBtnIcon}>＋</Text>
              <Text style={styles.addEventBtnText}>기록 추가</Text>
            </TouchableOpacity>

            {/* ── 검사 기록 ────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>검사 기록</Text>
              {records.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>검사 기록이 없습니다. 검사를 완료하면 여기에 표시됩니다</Text>
                </View>
              ) : (
                records.slice(0, 10).map((r) => (
                  <View key={r.id} style={styles.recordCard}>
                    <View style={styles.recordCardTop}>
                      <Text style={styles.recordModule}>{MODULE_LABELS[r.module] ?? MODULE_LABELS[r.module_label] ?? r.module_label}</Text>
                      <View style={styles.recordCardTopRight}>
                        <View style={[
                          styles.urgencyBadge,
                          { backgroundColor: URGENCY_BG[r.urgency] ?? '#90CAF9' },
                        ]}>
                          <Text style={[
                            styles.urgencyBadgeText,
                            { color: URGENCY_TEXT[r.urgency] ?? '#1A3A5C' },
                          ]}>
                            {URGENCY_LABEL[r.urgency] ?? r.urgency}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => confirmDeleteRecord(r)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.deleteBtn}
                        >
                          <Ionicons name="trash-outline" size={16} color="#FFB5A7" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <Text style={styles.recordDiagnosis} numberOfLines={2}>
                      {r.primary_diagnosis}
                    </Text>
                    <Text style={styles.recordDate}>
                      {new Date(r.created_at).toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* ── 백신 기록 ────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>백신 기록</Text>
              {vaccines.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>백신 기록이 없습니다</Text>
                </View>
              ) : (
                vaccines.map((v) => {
                  const isOverdue = !!v.next_due_at && new Date(v.next_due_at) < new Date()
                  return (
                    <View key={v.id} style={styles.vaccineCard}>
                      <Text style={styles.vaccineType}>{v.type}</Text>
                      <Text style={styles.vaccineDates}>
                        접종일: {new Date(v.administered_at).toLocaleDateString('ko-KR', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </Text>
                      {v.next_due_at && (
                        <Text style={[styles.vaccineNext, isOverdue && styles.vaccineOverdue]}>
                          {isOverdue ? '[만료됨]  ' : '다음 접종: '}
                          {new Date(v.next_due_at).toLocaleDateString('ko-KR', {
                            year: 'numeric', month: 'short', day: 'numeric',
                          })}
                        </Text>
                      )}
                      {v.notes && (
                        <Text style={styles.vaccineNotes}>{v.notes}</Text>
                      )}
                    </View>
                  )
                })
              )}
            </View>
          </>
        )}

        {/* ── 生成就医报告 ──────────────────────────────────── */}
        {false && state === 'loaded' && (
          <TouchableOpacity style={styles.reportBtn} onPress={handleGenerateReport} activeOpacity={0.8}>
            <Text style={styles.reportBtnText}>진료 보고서 생성</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>

      {/* ── 宠物档案编辑 Modal ─────────────────────────────────── */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !formSaving && setShowModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modalContainer}>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* Modal 标题行 */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{pet ? '프로필 편집' : '반려동물 프로필 만들기'}</Text>
                <TouchableOpacity
                  onPress={() => setShowModal(false)}
                  disabled={formSaving}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.modalClose}>취소</Text>
                </TouchableOpacity>
              </View>

              {/* 반려동물 이름 */}
              <Text style={styles.fieldLabel}>반려동물 이름 *</Text>
              <TextInput
                style={styles.textInput}
                value={formName}
                onChangeText={setFormName}
                placeholder="반려동물 이름을 입력하세요"
                placeholderTextColor="#A0AFC0"
                maxLength={20}
                returnKeyType="next"
              />

              {/* 종류 */}
              <Text style={styles.fieldLabel}>종류</Text>
              <View style={styles.speciesRow}>
                {(['cat', 'dog', 'other'] as SpeciesKey[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.speciesBtn, formSpecies === s && styles.speciesBtnActive]}
                    onPress={() => setFormSpecies(s)}
                    activeOpacity={0.75}
                  >
                    {s === 'cat' ? (
                      <Image source={require('../../assets/icons/cat.png')} style={styles.speciesBtnImage} />
                    ) : s === 'dog' ? (
                      <Image source={require('../../assets/icons/dog.png')} style={styles.speciesBtnImage} />
                    ) : (
                      <Text style={styles.speciesBtnIcon}>{SPECIES_INFO[s].icon[0]}</Text>
                    )}
                    <Text style={[
                      styles.speciesBtnLabel,
                      formSpecies === s && styles.speciesBtnLabelActive,
                    ]}>
                      {SPECIES_INFO[s].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 품종 */}
              <Text style={styles.fieldLabel}>품종 (선택사항)</Text>
              <TextInput
                style={styles.textInput}
                value={formBreed}
                onChangeText={setFormBreed}
                placeholder="예: 영국 단모, 골든 리트리버"
                placeholderTextColor="#A0AFC0"
                maxLength={30}
                returnKeyType="next"
              />

              {/* 나이 */}
              <Text style={styles.fieldLabel}>나이 (선택사항)</Text>
              <TextInput
                style={styles.textInput}
                value={formAge}
                onChangeText={setFormAge}
                placeholder="세, 예: 2.5"
                placeholderTextColor="#A0AFC0"
                keyboardType="decimal-pad"
                maxLength={5}
                returnKeyType="done"
              />

              {/* 保存按钮 */}
              <TouchableOpacity
                style={[styles.saveBtn, formSaving && styles.saveBtnDisabled]}
                onPress={handleSavePet}
                disabled={formSaving}
                activeOpacity={0.8}
              >
                {formSaving
                  ? <ActivityIndicator size="small" color="#2B3A55" />
                  : <Text style={styles.saveBtnText}>프로필 저장</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {/* ── 건강 이벤트 추가 Modal ────────────────────────────── */}
      <Modal
        visible={showEventModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => !eventSaving && setShowEventModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SafeAreaView style={styles.modalContainer}>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* 헤더 */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>기록 추가</Text>
                <TouchableOpacity
                  onPress={() => setShowEventModal(false)}
                  disabled={eventSaving}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.modalClose}>취소</Text>
                </TouchableOpacity>
              </View>

              {/* 이벤트 타입 선택 */}
              <Text style={styles.fieldLabel}>이벤트 종류</Text>
              <View style={styles.eventTypeRow}>
                {ALL_EVENT_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.eventTypeBtn, newEventType === t && styles.eventTypeBtnActive]}
                    onPress={() => setNewEventType(t)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.eventTypeBtnEmoji}>{EVENT_EMOJI[t]}</Text>
                    <Text style={[
                      styles.eventTypeBtnLabel,
                      newEventType === t && styles.eventTypeBtnLabelActive,
                    ]}>
                      {EVENT_LABEL[t]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 이벤트 날짜 */}
              <Text style={styles.fieldLabel}>날짜 *</Text>
              <TouchableOpacity
                style={styles.datePickerTrigger}
                onPress={() => {
                  setShowNextDatePicker(false)
                  setShowEventDatePicker((v) => !v)
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.datePickerText}>{toDisplayDate(newEventDate)}</Text>
                <Text style={styles.datePickerIcon}>📅</Text>
              </TouchableOpacity>
              {showEventDatePicker && (
                <DateTimePicker
                  value={newEventDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_: DateTimePickerEvent, selected?: Date) => {
                    if (Platform.OS === 'android') setShowEventDatePicker(false)
                    if (selected) setNewEventDate(selected)
                  }}
                  style={styles.datePickerInline}
                />
              )}

              {/* 다음 예정일 */}
              <Text style={styles.fieldLabel}>다음 예정일 (선택사항)</Text>
              <TouchableOpacity
                style={styles.datePickerTrigger}
                onPress={() => {
                  setShowEventDatePicker(false)
                  setShowNextDatePicker((v) => !v)
                  if (!newEventNextDate) setNewEventNextDate(defaultNextDate())
                }}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.datePickerText,
                  !newEventNextDate && styles.datePickerPlaceholder,
                ]}>
                  {newEventNextDate ? toDisplayDate(newEventNextDate) : '선택 안 함'}
                </Text>
                <View style={styles.datePickerRightGroup}>
                  {newEventNextDate && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation()
                        setNewEventNextDate(null)
                        setShowNextDatePicker(false)
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.datePickerClear}>✕</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.datePickerIcon}>📅</Text>
                </View>
              </TouchableOpacity>
              {showNextDatePicker && newEventNextDate && (
                <DateTimePicker
                  value={newEventNextDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_: DateTimePickerEvent, selected?: Date) => {
                    if (Platform.OS === 'android') setShowNextDatePicker(false)
                    if (selected) setNewEventNextDate(selected)
                  }}
                  style={styles.datePickerInline}
                />
              )}

              {/* 메모 */}
              <Text style={styles.fieldLabel}>메모 (선택사항)</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMulti]}
                value={newEventNote}
                onChangeText={setNewEventNote}
                placeholder="메모를 입력하세요"
                placeholderTextColor="#A0AFC0"
                multiline
                numberOfLines={3}
                returnKeyType="done"
              />

              {/* 저장 버튼 */}
              <TouchableOpacity
                style={[styles.saveBtn, eventSaving && styles.saveBtnDisabled]}
                onPress={handleSaveEvent}
                disabled={eventSaving}
                activeOpacity={0.8}
              >
                {eventSaving
                  ? <ActivityIndicator size="small" color="#2B3A55" />
                  : <Text style={styles.saveBtnText}>저장</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ── 样式 ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFCFF' },
  scroll:    { paddingTop: 8, paddingHorizontal: 20 },

  // ── 页面标题 ──────────────────────────────────────────────
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   20,
  },
  title: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   28,
    color:      '#2B3A55',
  },
  statsBadge: {
    backgroundColor: 'rgba(144,202,249,0.20)',
    borderRadius:    20,
    paddingHorizontal: 12,
    paddingVertical:   4,
    borderWidth:     1,
    borderColor:     'rgba(144,202,249,0.45)',
  },
  statsBadgeText: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize:   12,
    color:      '#1A3A5C',
  },

  // ── 中心对齐状态（loading / error）────────────────────────
  centered: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#7A8DA3',
    marginTop:  12,
  },
  errorIcon: { fontSize: 40, marginBottom: 12 }, // kept for layout compat
  errorText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   15,
    color:      '#7A8DA3',
    textAlign:  'center',
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    24,
    paddingHorizontal: 28,
    paddingVertical:   12,
  },
  retryBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   15,
    color:      '#2B3A55',
  },

  // ── 无档案引导 ────────────────────────────────────────────
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  emptyIcon:  { fontSize: 60, marginBottom: 16 },
  emptyTitle: {
    fontFamily:   'NotoSerifKR_700Bold',
    fontSize:     22,
    color:        '#2B3A55',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#7A8DA3',
    textAlign:  'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  primaryBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    28,
    paddingHorizontal: 32,
    paddingVertical:   14,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.40,
    shadowRadius:    16,
    elevation:       4,
  },
  primaryBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  // ── 宠物信息卡 ────────────────────────────────────────────
  petCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         18,
    marginBottom:    16,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.25,
    shadowRadius:    14,
    elevation:       3,
  },
  petCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  petIconWrap: {
    width:          52,
    height:         52,
    borderRadius:   26,
    backgroundColor: 'rgba(189,224,254,0.25)',
    alignItems:     'center',
    justifyContent: 'center',
    marginRight:    12,
  },
  avatarEditBadge: {
    position:        'absolute',
    bottom:          0,
    right:           0,
    width:           20,
    height:          20,
    borderRadius:    10,
    backgroundColor: '#90CAF9',
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarEditIcon: {
    color:    '#FFFFFF',
    fontSize: 11,
  },
  petSpeciesIcon: { fontFamily: 'NotoSerifKR_700Bold', fontSize: 20, color: '#2B3A55' },
  petCardInfo:    { flex: 1 },
  petName: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   20,
    color:      '#2B3A55',
    marginBottom: 2,
  },
  petMeta: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  editBtn: {
    backgroundColor: 'rgba(189,224,254,0.30)',
    borderRadius:    16,
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderWidth:     1,
    borderColor:     'rgba(189,224,254,0.55)',
  },
  editBtnText: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#2B3A55',
  },

  // ── 统计行 ────────────────────────────────────────────────
  statsRow: {
    flexDirection:  'row',
    marginBottom:   20,
    gap:            10,
  },
  statCard: {
    flex:            1,
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    paddingVertical: 14,
    alignItems:      'center',
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  statCardMid: { marginHorizontal: 0 },
  statValue: {
    fontFamily:   'RobotoMono_400Regular',
    fontSize:     22,
    color:        '#2B3A55',
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   11,
    color:      '#7A8DA3',
  },

  // ── 分区 ──────────────────────────────────────────────────
  section:      { marginBottom: 20 },
  sectionTitle: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     13,
    color:        '#7A8DA3',
    marginBottom: 10,
    letterSpacing: 0.5,
  },

  // ── 检测记录卡片 ──────────────────────────────────────────
  recordCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         16,
    marginBottom:    10,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  recordCardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  recordCardTopRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  deleteBtn: {
    padding: 2,
  },
  recordModule: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  urgencyBadge: {
    borderRadius:      20,
    paddingHorizontal: 10,
    paddingVertical:   3,
  },
  urgencyBadgeText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   12,
  },
  recordDiagnosis: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     15,
    color:        '#2B3A55',
    marginBottom: 4,
    lineHeight:   22,
  },
  recordDate: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize:   11,
    color:      '#A0AFC0',
  },

  // ── 疫苗记录卡片 ──────────────────────────────────────────
  vaccineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         16,
    marginBottom:    10,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.18,
    shadowRadius:    10,
    elevation:       2,
  },
  vaccineType: {
    fontFamily:   'Pretendard-SemiBold',
    fontSize:     15,
    color:        '#2B3A55',
    marginBottom: 4,
  },
  vaccineDates: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
    marginBottom: 2,
  },
  vaccineNext: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  vaccineOverdue: { color: '#D32F2F' },
  vaccineNotes: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   12,
    color:      '#A0AFC0',
    marginTop:  4,
  },

  // ── 空状态 ────────────────────────────────────────────────
  emptySection: {
    backgroundColor: '#FFFFFF',
    borderRadius:    16,
    padding:         20,
    alignItems:      'center',
  },
  emptySectionText: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   13,
    color:      '#A0AFC0',
    textAlign:  'center',
    lineHeight: 20,
  },

  // ── 档案编辑 Modal ────────────────────────────────────────
  modalContainer: { flex: 1, backgroundColor: '#FAFCFF' },
  modalScroll:    { paddingHorizontal: 24, paddingBottom: 40 },
  modalHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingTop:     20,
    marginBottom:   28,
  },
  modalTitle: {
    fontFamily: 'NotoSerifKR_700Bold',
    fontSize:   22,
    color:      '#2B3A55',
  },
  modalClose: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   16,
    color:      '#7A8DA3',
  },
  fieldLabel: {
    fontFamily:   'Pretendard-Medium',
    fontSize:     13,
    color:        '#7A8DA3',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     '#E8EFF6',
    paddingHorizontal: 16,
    paddingVertical:   14,
    fontFamily:      'Pretendard-Regular',
    fontSize:        15,
    color:           '#2B3A55',
    marginBottom:    20,
  },
  speciesRow: {
    flexDirection: 'row',
    gap:           10,
    marginBottom:  20,
  },
  speciesBtn: {
    flex:            1,
    paddingVertical: 14,
    borderRadius:    14,
    backgroundColor: '#FFFFFF',
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     '#E8EFF6',
  },
  speciesBtnActive: {
    borderColor:     '#90CAF9',
    backgroundColor: 'rgba(144,202,249,0.12)',
  },
  speciesBtnIcon:  { fontFamily: 'NotoSerifKR_700Bold', fontSize: 18, color: '#2B3A55', marginBottom: 4 },
  speciesBtnImage: { width: 52, height: 52, resizeMode: 'contain', marginBottom: 10 },
  speciesBtnLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   13,
    color:      '#7A8DA3',
  },
  speciesBtnLabelActive: { color: '#1A3A5C' },
  saveBtn: {
    width:           '100%',
    height:          56,
    borderRadius:    28,
    backgroundColor: '#BDE0FE',
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       8,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.40,
    shadowRadius:    16,
    elevation:       4,
  },
  saveBtnDisabled: { opacity: 0.55 },
  saveBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  reportBtn: {
    backgroundColor: '#BDE0FE',
    borderRadius:    28,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       4,
    marginBottom:    16,
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.35,
    shadowRadius:    12,
    elevation:       3,
  },
  reportBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   16,
    color:      '#2B3A55',
  },

  bottomPad: { height: 100 },

  // ── 다가오는 일정 ─────────────────────────────────────────────
  upcomingScroll: {
    paddingRight: 4,
    gap: 10,
  },
  upcomingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    18,
    padding:         16,
    width:           110,
    alignItems:      'center',
    shadowColor:     '#BDE0FE',
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.22,
    shadowRadius:    10,
    elevation:       2,
  },
  upcomingEmoji: {
    fontSize:     26,
    marginBottom: 6,
  },
  upcomingLabel: {
    fontFamily:   'Pretendard-Medium',
    fontSize:     12,
    color:        '#2B3A55',
    marginBottom: 6,
    textAlign:    'center',
  },
  upcomingDays: {
    fontFamily:   'RobotoMono_400Regular',
    fontSize:     15,
    color:        '#90CAF9',
    marginBottom: 4,
  },
  upcomingDate: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   11,
    color:      '#A0AFC0',
  },

  // ── 기록 추가 버튼 ────────────────────────────────────────────
  addEventBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(189,224,254,0.20)',
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     'rgba(189,224,254,0.55)',
    borderStyle:     'dashed',
    paddingVertical: 14,
    marginBottom:    20,
    gap:             6,
  },
  addEventBtnIcon: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   20,
    color:      '#90CAF9',
    lineHeight: 22,
  },
  addEventBtnText: {
    fontFamily: 'Pretendard-SemiBold',
    fontSize:   14,
    color:      '#2B3A55',
  },

  // ── 이벤트 타입 선택 ──────────────────────────────────────────
  eventTypeRow: {
    flexDirection: 'row',
    gap:           8,
    marginBottom:  20,
  },
  eventTypeBtn: {
    flex:            1,
    paddingVertical: 12,
    borderRadius:    14,
    backgroundColor: '#FFFFFF',
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     '#E8EFF6',
  },
  eventTypeBtnActive: {
    borderColor:     '#90CAF9',
    backgroundColor: 'rgba(144,202,249,0.12)',
  },
  eventTypeBtnEmoji: {
    fontSize:     22,
    marginBottom: 4,
  },
  eventTypeBtnLabel: {
    fontFamily: 'Pretendard-Medium',
    fontSize:   11,
    color:      '#7A8DA3',
  },
  eventTypeBtnLabelActive: { color: '#1A3A5C' },

  // ── multiline TextInput ───────────────────────────────────────
  textInputMulti: {
    height:     88,
    textAlignVertical: 'top',
    paddingTop: 14,
  },

  // ── DatePicker 트리거 버튼 ─────────────────────────────────────
  datePickerTrigger: {
    backgroundColor:   '#FFFFFF',
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       '#E8EFF6',
    paddingHorizontal: 16,
    paddingVertical:   14,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    marginBottom:      20,
  },
  datePickerText: {
    fontFamily: 'RobotoMono_400Regular',
    fontSize:   15,
    color:      '#2B3A55',
  },
  datePickerPlaceholder: {
    color: '#A0AFC0',
    fontFamily: 'Pretendard-Regular',
  },
  datePickerIcon: {
    fontSize: 18,
  },
  datePickerRightGroup: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  datePickerClear: {
    fontFamily: 'Pretendard-Regular',
    fontSize:   14,
    color:      '#A0AFC0',
  },
  datePickerInline: {
    marginTop:    -14,   // 버튼과 붙어 보이도록
    marginBottom: 8,
    alignSelf:    'stretch',
  },
})
