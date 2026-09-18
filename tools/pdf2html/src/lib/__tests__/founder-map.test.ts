import { describe, expect, it } from 'vitest'
import { mapFounderMath } from '../founder-map'

describe('founder-map 方正数学字体映射', () => {
  it('根号与小写斜体字母', () => {
    expect(mapFounderMath('槡１６×８１').text).toBe('√１６×８１')
    expect(mapFounderMath('槡４犪２犫３').text).toBe('√４a２b３')
    expect(mapFounderMath('槡３狓·１狓狔').text).toBe('√３x·１xy')
  })

  it('大写字母与单词级还原', () => {
    expect(mapFounderMath('犕犲犪狀').text).toBe('Mean')
    expect(mapFounderMath('犕犆犆').text).toBe('MCC')
    expect(mapFounderMath('犽狏t').text).toBe('kvt')
  })

  it('统计命中数,普通文本零命中', () => {
    expect(mapFounderMath('犪犫犮').hits).toBe(3)
    expect(mapFounderMath('正常中文 abc 123').hits).toBe(0)
    expect(mapFounderMath('').hits).toBe(0)
  })
})
