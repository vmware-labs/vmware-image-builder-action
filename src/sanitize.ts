const illegalRe = /[/?<>\\:*|"]/g
 
const controlRe = /[\x00-\x1f\x80-\x9f]/g
const reservedRe = /^\.+$/

export function sanitize(input: string, replacement: string): string {
  if (typeof input !== "string") {
    throw new Error("Input must be string")
  }

  return input.replace(illegalRe, replacement).replace(controlRe, replacement).replace(reservedRe, replacement)
}
