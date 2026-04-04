/**
 * translateService.ts — 번역 서비스
 *
 * [A] translate()          — check.tsx 텍스트 번역 (Qwen qwen-max)
 * [B] translatePetToHuman()— 녹음 오디오 → 반려동물 감정/언어 해석 (FastAPI)
 * [C] translateHumanToPet()— 인간 텍스트 → 반려동물 언어 변환 (FastAPI)
 */

import type { HumanToPetResponse, Pet, PetToHumanResponse } from '@/types/translate'

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1'

const API_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
const API_KEY = process.env.EXPO_PUBLIC_QWEN_API_KEY ?? ''
const MODEL = 'qwen-max'

export type TranslateMode = 'human_to_pet' | 'pet_to_human'

const SYSTEM_PROMPTS: Record<TranslateMode, string> = {
  human_to_pet: `당신은 인간의 말을 반려동물이 이해할 수 있는 방식으로 번역하는 전문 통역사입니다.

규칙:
- 반려동물의 감각(냄새, 소리, 즉각적 감정)에 기반한 언어로 변환하세요
- 짧고 직관적이며 행동 지향적인 표현을 사용하세요
- 이모지를 1~2개 포함하세요
- 반드시 한국어로 작성하세요
- 2~4문장 이내로 간결하게 작성하세요`,

  pet_to_human: `당신은 반려동물의 행동이나 소리를 인간의 언어로 해석하는 전문 동물행동학자입니다.

규칙:
- ~같아요, ~보여요, ~라고 하는 것 같아요 같은 불확실한 표현을 사용하세요
- 공감적이고 따뜻한 어조로 작성하세요
- 이모지를 1~2개 포함하세요
- 반드시 한국어로 작성하세요
- 2~4문장 이내로 간결하게 작성하세요`,
}

const USER_PROMPTS: Record<TranslateMode, (text: string) => string> = {
  human_to_pet: (text) =>
    `다음 인간의 말을 반려동물이 이해할 수 있게 번역해주세요:\n\n"${text}"`,
  pet_to_human: (text) =>
    `다음 반려동물의 행동이나 소리를 인간의 언어로 해석해주세요:\n\n"${text}"`,
}

export async function translate(
  text: string,
  mode: TranslateMode
): Promise<string> {
  if (!text.trim()) throw new Error('번역할 내용을 입력해주세요.')
  if (!API_KEY) throw new Error('API 키가 설정되지 않았습니다.')

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPTS[mode] },
      { role: 'user', content: USER_PROMPTS[mode](text.trim()) },
    ],
    temperature: 0.8,
    max_tokens: 300,
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`번역 API 오류 (${response.status}): ${errText}`)
  }

  const json = await response.json()
  const content: string = json?.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('번역 결과를 받지 못했습니다.')
  return content.trim()
}

// ── [B] 반려동물 → 인간 (FastAPI) ────────────────────────────

export async function translatePetToHuman(
  audioBase64: string,
  petType: Pet['type'],
  petName: string,
): Promise<PetToHumanResponse> {
  const response = await fetch(`${BACKEND_URL}/translate/pet-to-human`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64: audioBase64, pet_type: petType, pet_name: petName }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    const isNetwork = errText === '' && response.status === 0
    throw new Error(
      isNetwork ? 'NETWORK_ERROR' : `번역 서버 오류 (${response.status})`,
    )
  }

  return response.json() as Promise<PetToHumanResponse>
}

// ── [C] 인간 → 반려동물 (FastAPI) ────────────────────────────

export async function translateHumanToPet(
  text: string,
  petType: Pet['type'],
): Promise<HumanToPetResponse> {
  const response = await fetch(`${BACKEND_URL}/translate/human-to-pet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, pet_type: petType }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    const isNetwork = errText === '' && response.status === 0
    throw new Error(
      isNetwork ? 'NETWORK_ERROR' : `번역 서버 오류 (${response.status})`,
    )
  }

  return response.json() as Promise<HumanToPetResponse>
}
