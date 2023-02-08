import path from 'path'
import fs from "fs"

export function runtimeParameters() {
  return fs.readFileSync(path.join(__dirname, '..', 'resources', '.vib', 'runtime-parameters-file.yaml'))
  .toString()
  .trim()
}
