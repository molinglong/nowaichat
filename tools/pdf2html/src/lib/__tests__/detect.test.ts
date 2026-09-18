import { describe, expect, it } from 'vitest'
import { garbledRatio, isScannedPage, describePdfError } from '../detect'

describe('detect 质检', () => {
  it('低字符页判定为扫描页', () => {
    expect(isScannedPage(0)).toBe(true)
    expect(isScannedPage(9)).toBe(true)
    expect(isScannedPage(10)).toBe(false)
  })

  it('乱码比例只统计非空白字符', () => {
    expect(garbledRatio('正常文字')).toBe(0)
    expect(garbledRatio('\uFFFD\uFFFD正常')).toBeCloseTo(0.5)
    expect(garbledRatio('\uE000正常文字')).toBeCloseTo(0.2)
    expect(garbledRatio('   ')).toBe(0)
  })

  it('pdfjs 错误归类为用户可读文案', () => {
    expect(describePdfError({ name: 'PasswordException' })).toContain('加密')
    expect(describePdfError({ name: 'InvalidPDFException' })).toContain('有效')
    expect(describePdfError(new Error('boom'))).toBe('boom')
  })
})
