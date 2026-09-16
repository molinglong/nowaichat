/** 学科 id → 中文显示名。与服务端 tagging.ts 的 NOTE_SUBJECTS 保持一致(keys 必须相同)。 */
export const SUBJECT_LABELS = {
  math: '数学',
  english: '英语',
  chinese: '语文',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  other: '其他',
} as const

export type NoteSubject = keyof typeof SUBJECT_LABELS
