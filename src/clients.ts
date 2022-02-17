import * as constants from "./constants"
import * as core from "@actions/core"
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios"

export function newClient(cfg: AxiosRequestConfig): AxiosInstance {
  const instance = axios.create(cfg)
  instance.interceptors.response.use(undefined, async (err: AxiosError) => {
    const config = err.config
    const response = err.response

    if (
      (response &&
        response.status &&
        Object.values(constants.RetriableHttpStatus).includes(
          response.status
        )) ||
      err.code === "ECONNABORTED" ||
      err.message === "Network Error"
    ) {
      // Not sure if this message is trustable or just something moxios made up
      core.debug(`Error: ${JSON.stringify(err)}`)
      const currentState = config["vib-retries"] || {}
      currentState.retryCount = currentState.retryCount || 0
      config["vib-retries"] = currentState

      const delay = constants.HTTP_RETRY_INTERVALS[currentState.retryCount]
      if (currentState.retryCount >= constants.HTTP_RETRY_COUNT) {
        return Promise.reject(
          new Error(
            `Could not execute operation. Retried ${currentState.retryCount} times.`
          )
        )
      } else {
        core.info(
          `Request to ${config.url} failed. Retry: ${currentState.retryCount}. Waiting ${delay}`
        )
        currentState.retryCount += 1
      }
      config.transformRequest = [data => data]

      return new Promise(resolve =>
        setTimeout(() => resolve(instance(config)), delay)
      )
    } else {
      return Promise.reject(err)
    }
  })

  return instance
}
