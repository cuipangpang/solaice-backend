/**
 * translateService.ts — 인간↔반려동물 양방향 번역 서비스
 *
 * - 인간→반려동물: 인간의 말을 반려동물이 이해할 수 있는 표현으로 변환
 * - 반려동물→인간: 반려동물의 행동/소리를 인간의 언어로 해석
 * - DashScope qwen-max (텍스트 전용) 사용
 */

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
