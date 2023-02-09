// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function passed(): {[key: string]: any} {
  return {
    report: {
      passed: true,
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function failed(): {[key: string]: any} {
  return {
    report: {
      passed: false,
    }
  }
}