import * as constants from "./constants"
import * as core from "@actions/core"
import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, RawAxiosRequestHeaders } from "axios"
import { ClientConfig } from "./client-config"
import axios from "axios"

export function newClient(axiosCfg: AxiosRequestConfig, clientCfg: ClientConfig): AxiosInstance {
  const instance = axios.create(axiosCfg)

  instance.interceptors.request.use(async (config: AxiosRequestConfig) => {
    config["startTime"] = new Date()
    return config
  })

  instance.interceptors.response.use(
    async (response: AxiosResponse) => {
      if (response && response.config) {
        const endTime = new Date()
        const duration = endTime.getTime() - response.config["startTime"].getTime()
        if (duration > constants.SLOW_REQUEST_THRESHOLD) {
          core.info(`Slow response detected: ${duration}ms`)
        }
      }
      return response
    },
    async (err: AxiosError) => {
      const config = err.config
      const response = err.response
      const maxRetries = clientCfg.retries ? clientCfg.retries : constants.HTTP_RETRY_COUNT
      const backoffIntervals = clientCfg.backoffIntervals ? clientCfg.backoffIntervals : constants.HTTP_RETRY_INTERVALS
      const retriableErrorCodes = clientCfg.retriableErrorCodes
        ? clientCfg.retriableErrorCodes
        : constants.RETRIABLE_ERROR_CODES

      core.debug(
        `Error: ${JSON.stringify(err)}. Status: ${response ? response.status : "unknown"}. Data: ${
          response ? JSON.stringify(response.data) : "unknown"
        }`
      )

      if (
        (response && response.status && Object.values(constants.RetriableHttpStatus).includes(response.status)) ||
        (err.code !== undefined && retriableErrorCodes.includes(err.code)) ||
        err.message === "Network Error"
      ) {
        // Not sure if this message is trustable or just something moxios made up
        if (config == null) {
          core.debug("Could not find configuration on axios error. Exiting.")
          return Promise.reject(err)
        }

        //TODO: To be removed when https://github.com/axios/axios/issues/5089 gets closed.
        config.headers = JSON.parse(JSON.stringify(config.headers || {})) as RawAxiosRequestHeaders

        const currentState = config["vib-retries"] || {}
        currentState.retryCount = currentState.retryCount || 0
        config["vib-retries"] = currentState

        const index =
          currentState.retryCount >= backoffIntervals.length ? backoffIntervals.length - 1 : currentState.retryCount
        let delay = backoffIntervals[index]

        if (response && response.headers && response.headers["Retry-After"]) {
          const retryAfter = Number.parseInt(response.headers["Retry-After"])
          if (!Number.isNaN(retryAfter)) {
            delay = Number.parseInt(response.headers["Retry-After"]) * 1000
            core.debug(`Following server advice. Will retry after ${response.headers["Retry-After"]} seconds`)
          } else {
            core.debug(`Could not parse Retry-After header value ${response.headers["Retry-After"]}`)
          }
        }

        if (currentState.retryCount >= maxRetries) {
          core.debug("The number of retries exceeds the limit.")
          return Promise.reject(new Error(`Could not execute operation. Retried ${currentState.retryCount} times.`))
        } else {
          core.info(
            `Request to ${config.url} failed. Retry: ${currentState.retryCount}. Waiting ${delay}. [Error: ${
              err.message
            }, Status: ${response ? response.status : "unknown"}, Response headers: ${JSON.stringify(
              response?.headers
            )}`
          )
          currentState.retryCount += 1
        }
        config.transformRequest = [data => data]

        return new Promise(resolve =>
          setTimeout(() => {
            config["startTime"] = new Date() // Reset slow response count
            resolve(instance(config))
          }, delay)
        )
      } else {
        core.debug(
          `Error message: ${err.message}. Status: ${response ? response.status : "unknown"}. 
        Response headers: ${response?.headers}. Stack: ${err.stack}`
        )

        return Promise.reject(err)
      }
    }
  )

  return instance
}
