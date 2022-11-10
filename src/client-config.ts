export interface ClientConfig {
  retries?: number
  backoffIntervals?: number[]
  retriableErrorCodes?: string[]
}
