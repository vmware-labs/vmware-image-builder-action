import { ExecutionGraphReport } from '../../src/client/vib/api'

export function report(): ExecutionGraphReport {
  return {
    passed: true,
    actions: [
      {
        task_id: '8b9ea8f0-06d7-4332-b353-afcbadfc89ea',
        action_id: 'trivy',
        passed: false,
        vulnerabilities: {
          minimal: 6,
          low: 5,
          medium: 4,
          high: 3,
          critical: 2,
          unknown: 1
        }
      },
      {
        task_id: 'd426abec-4d9e-44d1-b540-0448197d5651',
        action_id: 'cypress',
        passed: true,
        tests: {
          passed: 3,
          skipped: 2,
          failed: 1
        }
      }
    ]
  }
}