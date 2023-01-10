import * as core from "@actions/core"
import { getNumberArray, getNumberInput } from "../util"
import type { AxiosInstance } from "axios"
import { Readable } from "stream"
import axios from "axios"
import moment from "moment"
import { newClient } from "./clients"
import util from "util"

export enum VerificationModes {
  PARALLEL = "PARALLEL",
  SERIAL = "SERIAL",
}

export enum States {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export interface TargetPlatform {
  id: string
  kind: string
  version: string
}

const DEFAULT_HTTP_TIMEOUT = 120000

const DEFAULT_VERIFICATION_MODE = VerificationModes.PARALLEL

const DEFAULT_VIB_PUBLIC_URL = "https://cp.bromelia.vmware.com"

const HTTP_RETRY_COUNT = 3

const HTTP_RETRY_INTERVALS = process.env.JEST_WORKER_ID ? [500, 1000, 2000] : [5000, 10000, 15000]

const USER_AGENT_VERSION = process.env.GITHUB_ACTION_REF ? process.env.GITHUB_ACTION_REF : "unknown"

class VIB {
  client: AxiosInstance
  url: string

  constructor() {
    this.url = process.env.VIB_PUBLIC_URL ? process.env.VIB_PUBLIC_URL : DEFAULT_VIB_PUBLIC_URL
    this.client = newClient(
      {
        baseURL: this.url,
        timeout: getNumberInput("http-timeout", DEFAULT_HTTP_TIMEOUT),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `vib-action/${USER_AGENT_VERSION}`,
        },
      },
      {
        retries: getNumberInput("retry-count", HTTP_RETRY_COUNT),
        backoffIntervals: getNumberArray("backoff-intervals", HTTP_RETRY_INTERVALS),
      }
    )
  }

  async createPipeline(
    pipeline: string,
    pipelineDuration: number,
    verificationMode?: VerificationModes,
    token?: string
  ): Promise<string> {
    try {
      const pipelinePath = "/v1/pipelines"
      core.debug(`Sending pipeline to ${pipelinePath}: ${util.inspect(pipeline)}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.post(pipelinePath, pipeline, {
        headers: {
          ...authorization,
          "X-Verification-Mode": `${verificationMode || DEFAULT_VERIFICATION_MODE}`,
          "X-Expires-After": moment()
            .add(pipelineDuration * 1000, "s")
            .format("ddd, DD MMM YYYY HH:mm:ss z"),
        },
      })

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      const locationHeader = response.headers["location"]?.toString()
      if (!locationHeader) {
        throw new Error("Location header not found")
      }

      return locationHeader.substring(locationHeader.lastIndexOf("/") + 1)
    } catch (error) {
      core.debug(JSON.stringify(error))
      throw new Error(`Unexpected error creating pipeline.`)
    }
  }

  async getExecutionGraph(executionGraphId: string, token?: string): Promise<Object> {
    try {
      const executionGraphPath = `/v1/execution-graphs/${executionGraphId}`
      core.debug(`Getting execution graph from ${executionGraphPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(executionGraphPath, { headers: { ...authorization } })

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        if (err.response.status === 404) {
          core.debug(JSON.stringify(err))
          throw new Error(
            err.response.data ? err.response.data.detail : `Could not find execution graph with id ${executionGraphId}`
          )
        }
        throw err
      }
      throw err
    }
  }

  async getExecutionGraphReport(executionGraphId: string, token?: string): Promise<Object> {
    try {
      const executionGraphReportPath = `/v1/execution-graphs/${executionGraphId}/report`
      core.debug(`Downloading execution graph report from ${executionGraphReportPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(executionGraphReportPath, { headers: { ...authorization } })

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err))
        throw new Error(
          `Error fetching execution graph ${executionGraphId} report. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getRawLogs(executionGraphId: string, taskId: string, token?: string): Promise<string> {
    try {
      const logsPath = `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/logs/raw`
      core.debug(`Downloading logs from ${this.url}${logsPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(logsPath, { headers: { ...authorization } })

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err))
        throw new Error(
          `Error fetching logs for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getRawReport(executionGraphId: string, taskId: string, reportId: string, token?: string): Promise<Readable> {
    try {
      const rawReportPath = `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports/${reportId}`
      core.debug(`Downloading raw report from ${this.url}${rawReportPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(rawReportPath, {
        headers: { ...authorization },
        responseType: "stream",
      })

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err))
        throw new Error(
          `Error fetching raw report ${reportId} for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getRawReports(executionGraphId: string, taskId: string, token?: string): Promise<Object[]> {
    try {
      const rawReportsPath = `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports`
      core.debug(`Getting raw reports from ${this.url}${rawReportsPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(rawReportsPath, { headers: { ...authorization } })

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err))
        throw new Error(
          `Error fetching raw reports for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getTargetPlatforms(token?: string): Promise<Object[]> {
    try {
      const targetPlatformsPath = "/v1/target-platforms"
      core.debug(`Getting target platforms from ${this.url}${targetPlatformsPath}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.get(targetPlatformsPath, { headers: { ...authorization } })

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err))
        throw new Error(
          `Error fetching target platforms. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async validatePipeline(pipeline: string, token?: string): Promise<string[]> {
    try {
      core.debug(`Validating pipeline: ${util.inspect(pipeline)}`)

      const authorization = token ? { Authorization: `Bearer ${token}` } : {}
      const response = await this.client.post("/v1/pipelines/validate", pipeline, {
        headers: { ...authorization },
      })

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return []
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 400) {
          return (
            error.response?.data?.violations.map(
              violation => `Field: ${violation.field}. Error: ${violation.message}.`
            ) || [error.response?.data?.detail] || [error.response?.data] || ["The pipeline given is not correct."]
          )
        }

        throw new Error(
          `Could not reach out to VIB. Please try again. Code: ${error.response.status}. Message: ${error.response.statusText}`
        )
      } else {
        throw error
      }
    }
  }
}

export default VIB
