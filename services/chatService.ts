/**
 * chatService.ts — 다중 턴 AI 상담 서비스
 *
 * - 세션 관리: POST /api/v1/chat/session
 * - SSE 스트리밍: POST /api/v1/chat/message (fetch + ReadableStream)
 * - 대화 기록: GET /api/v1/chat/session/{id}/history
 * - 세션 목록: GET /api/v1/chat/sessions/{pet_id}
 * - 세션 종료: DELETE /api/v1/chat/session/{id}
 */

import EventSource from 'react-native-sse'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ── 타입 정의 ─────────────────────────────────────────────────

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
  turnIndex: number
  timestamp: string
  isStreaming?: boolean
}

export interface ChatSession {
  sessionId: string
  petId: string
  turnCount: number
  stage: 'questioning' | 'diagnosis'
  createdAt: string
}

export interface DiagnosisResult {
  urgency: 'green' | 'orange' | 'red'
  primaryDiagnosis: string
  symptoms: string[]
  actionPlan: string
  homeCare: string
  followUpQuestions: string[]
  ragSources: string[]
}

// ── 세션 생성 ─────────────────────────────────────────────────

export async function createChatSession(petId: string): Promise<ChatSession> {
  const response = await fetch(`${BASE_URL}/chat/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pet_id: petId }),
  })

  if (!response.ok) {
    throw new Error(`세션 생성 실패: HTTP ${response.status}`)
  }

  const json = await response.json()
  if (!json.success) {
    throw new Error(json.error?.message || '세션 생성에 실패했습니다')
  }

  const data = json.data
  return {
    sessionId: data.session_id,
    petId: data.pet_id,
    turnCount: data.turn_count,
    stage: data.stage,
    createdAt: data.created_at,
  }
}

// ── SSE 메시지 전송 ───────────────────────────────────────────

export async function sendChatMessage(params: {
  sessionId: string
  petId: string
  content: string
  imageUrl?: string | null
  imageData?: string | null   // base64 data URI — S3 URL 대체
  mode?: 'fast' | 'thinking'
  onToken: (token: string) => void
  onDone: (result: {
    reply: string | DiagnosisResult
    stage: string
    turn: number
    ragSources: string[]
    urgency: string | null
  }) => void
  onError: (error: Error) => void
  signal?: AbortSignal
}): Promise<void> {
  const { sessionId, petId, content, imageUrl, imageData, mode, onToken, onDone, onError, signal } = params

  // <thinking_process>...</thinking_process> 블록을 UI에서 제거
  function stripThinking(text: string): string {
    return text.replace(/<thinking_process>[\s\S]*?<\/thinking_process>/gi, '').trim()
  }

  return new Promise((resolve) => {
    const url = `${BASE_URL}/chat/message`
    console.log('[chatService] → SSE 요청 URL:', url)
    console.log('[chatService] → body:', {
      session_id: sessionId, pet_id: petId, content, mode,
      has_image: !!(imageData || imageUrl),
    })

    // 스트리밍 thinking 필터링 상태
    let tokenAccum = ''
    let displayedLen = 0

    const es = new EventSource(url, {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        pet_id: petId,
        content,
        image_url: imageUrl ?? null,
        image_data: imageData ?? null,
        mode: mode ?? 'fast',
      }),
      pollingInterval: 0,
    })

    es.addEventListener('message', (event) => {
      if (!event.data || event.data === '[DONE]') return

      console.log('[chatService] ← SSE 이벤트:', event.data)

      try {
        const parsed = JSON.parse(event.data)

        if (parsed.type === 'token') {
          // <thinking_process> 블록이 완성될 때까지 누적 후 필터링
          tokenAccum += parsed.content ?? ''
          // 완성된 thinking 블록 제거 + 아직 열려있는 태그 이후 숨김
          const displayable = stripThinking(tokenAccum)
            .replace(/<thinking_process>[\s\S]*$/i, '')
          const newPart = displayable.slice(displayedLen)
          if (newPart) {
            displayedLen = displayable.length
            onToken(newPart)
          }
        } else if (parsed.type === 'done') {
          // reply 변환 (snake_case → camelCase) + thinking 블록 제거
          let reply: string | DiagnosisResult =
            typeof parsed.reply === 'string' ? stripThinking(parsed.reply) : parsed.reply
          if (typeof parsed.reply === 'object' && parsed.reply !== null) {
            reply = {
              urgency: parsed.reply.urgency,
              primaryDiagnosis: parsed.reply.primary_diagnosis ?? '',
              symptoms: parsed.reply.symptoms ?? [],
              actionPlan: parsed.reply.action_plan ?? '',
              homeCare: parsed.reply.home_care ?? '',
              followUpQuestions: parsed.reply.follow_up_questions ?? [],
              ragSources: parsed.reply.rag_sources ?? parsed.rag_sources ?? [],
            } as DiagnosisResult
          }
          onDone({
            reply,
            stage: parsed.stage,
            turn: parsed.turn,
            ragSources: parsed.rag_sources ?? [],
            urgency: parsed.urgency ?? null,
          })
          es.close()
          resolve()
        } else if (parsed.type === 'error') {
          console.error('[chatService] ← 서버 오류:', parsed.message)
          onError(new Error(parsed.message ?? '서버 오류'))
          es.close()
          resolve()
        }
      } catch (e) {
        console.warn('[chatService] ← JSON 파싱 실패:', event.data)
      }
    })

    es.addEventListener('error', (event: any) => {
      console.error('[chatService] ← SSE 연결 오류:', event)
      es.close()
      onError(new Error('연결 오류가 발생했습니다. 다시 시도해 주세요.'))
      resolve()
    })

    if (signal) {
      signal.addEventListener('abort', () => {
        console.log('[chatService] ← 사용자가 취소했습니다')
        es.close()
        resolve()
      })
    }
  })
}

// ── 대화 기록 조회 ────────────────────────────────────────────

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(`${BASE_URL}/chat/session/${sessionId}/history`, {
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`대화 기록 조회 실패: HTTP ${response.status}`)
  }

  const json = await response.json()
  if (!json.success) {
    throw new Error(json.error?.message || '대화 기록 조회에 실패했습니다')
  }

  return (json.data as any[]).map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    imageUrl: msg.image_url ?? null,
    turnIndex: msg.turn_index,
    timestamp: msg.created_at,
  }))
}

// ── 세션 목록 ─────────────────────────────────────────────────

export async function getPetSessions(petId: string): Promise<ChatSession[]> {
  const response = await fetch(`${BASE_URL}/chat/sessions/${petId}`, {
    headers: { 'Content-Type': 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`세션 목록 조회 실패: HTTP ${response.status}`)
  }

  const json = await response.json()
  if (!json.success) {
    throw new Error(json.error?.message || '세션 목록 조회에 실패했습니다')
  }

  return (json.data as any[]).map((s) => ({
    sessionId: s.session_id,
    petId: s.pet_id,
    turnCount: s.turn_count,
    stage: s.stage as 'questioning' | 'diagnosis',
    createdAt: s.created_at,
  }))
}

// ── 세션 종료 ─────────────────────────────────────────────────

export async function closeChatSession(sessionId: string): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/chat/session/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) {
      console.warn(`[chatService] 세션 종료 실패: HTTP ${response.status}`)
    }
  } catch (error) {
    console.warn('[chatService] 세션 종료 오류:', error)
  }
}
