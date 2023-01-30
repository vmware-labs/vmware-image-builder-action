import * as core from "@actions/core"

export function getNumberInput(name: string, value: number): number {
  const input = parseInt(core.getInput(name))
  return isNaN(input) ? value : input
}

export function getNumberArray(name: string, defaultValues: number[]): number[] {
  const value = core.getInput(name)
  if (typeof value === "undefined" || value === "") {
    return defaultValues
  }

  try {
    const arrNums = JSON.parse(value)

    if (typeof arrNums === "object") {
      return arrNums.map(it => Number(it))
    } else {
      return [Number.parseInt(arrNums)]
    }
  } catch (err) {
    core.debug(`Could not process ${name} value. ${err}`)
    core.warning(`Invalid value for ${name}. Using defaults.`)
  }
  return defaultValues
}
