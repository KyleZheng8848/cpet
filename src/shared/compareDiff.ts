/** 对比列最后一轮文本的简易行 diff（无第三方依赖）。 */

export type DiffLine = {
  type: 'same' | 'add' | 'del'
  text: string
}

export function splitLines(text: string): string[] {
  return (text || '').replace(/\r\n/g, '\n').split('\n')
}

/** Myers 简化版：对中短文本够用。 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = splitLines(a)
  const B = splitLines(b)
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: 'same', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: A[i] })
      i++
    } else {
      out.push({ type: 'add', text: B[j] })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: A[i++] })
  }
  while (j < m) {
    out.push({ type: 'add', text: B[j++] })
  }
  return out
}
