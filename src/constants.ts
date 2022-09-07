/**
 * Base folder where VIB content can be found
 *
 * @default '.vib'
 */
export const DEFAULT_BASE_FOLDER = ".vib"

/**
 * Base VIB pipeline file
 *
 * @default 'vib-pipeline.json'
 */
export const DEFAULT_PIPELINE = "vib-pipeline.json"

/**
 * Max waiting time for an execution graph to complete
 *
 * @default 90 minutes
 */
export const DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT = 90 * 60 * 1000

/**
 * Interval for checking the execution graph status
 *
 * @default 30 seconds
 */
export const DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL = 30 * 1000 // 30 seconds

/**
 * Max caching time for valid CSP tokens
 *
 * @default 10 minutes
 */
export const CSP_TIMEOUT: number = 10 * 60 * 1000 // 10 minutes

/**
 * Valid states indicating that the execution graph processing has completed
 */
export enum EndStates {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

/**
 * Default target platform to be used if the user does not provide one
 *
 * @default GKE: 91d398a2-25c4-4cda-8732-75a3cfc179a1
 */
export const DEFAULT_TARGET_PLATFORM = "91d398a2-25c4-4cda-8732-75a3cfc179a1" // GKE

/**
 * Default VIB public URL. This endpoint requires authentication
 */
export const DEFAULT_VIB_PUBLIC_URL = "https://cp.bromelia.vmware.com"

/**
 * Default URL to the VMware Cloud Services Platform. This service provides identity access
 */
export const DEFAULT_CSP_API_URL = "https://console.cloud.vmware.com"

/**
 * Number of times a failed HTTP request due to timeout should be retried
 */
export const HTTP_RETRY_COUNT = 3

/**
 * Number of seconds that the next request should be delayed for. Array length must match the number of retries.
 */
export const HTTP_RETRY_INTERVALS = process.env.JEST_WORKER_ID !== undefined ? [500, 1000, 2000] : [5000, 10000, 15000]

/**
 * Retriable status codes
 */
export enum RetriableHttpStatus {
  BAD_GATEWAY = 502,
  SERVICE_NOT_AVAILABLE = 503,
  REQUEST_TIMEOUT = 408,
  TOO_MANY_REQUESTS = 429,
}

/**
 * Prefix for environment variables that will be used for template substitution in pipelines.
 */
export const ENV_VAR_TEMPLATE_PREFIX = "VIB_ENV_"

/**
 * CSP endpoint to get API token details
 */
export const TOKEN_DETAILS_PATH = "/csp/gateway/am/api/auth/api-tokens/details"

/**
 * CSP endpoint to exchange refresh_token grant
 */
export const TOKEN_AUTHORIZE_PATH = "/csp/gateway/am/api/auth/api-tokens/authorize"

/**
 * Token expiration days to pop up a warning
 */
export const EXPIRATION_DAYS_WARNING = 30

/**
 * Number of seconds the GitHub Action waits for an HTTP timeout before failing
 *
 * @default 30 seconds
 */
export const DEFAULT_HTTP_TIMEOUT = 30000

/**
 * The mode of vefircation in the API x-verification-mode
 */
export const DEFAULT_VERIFICATION_MODE = true
