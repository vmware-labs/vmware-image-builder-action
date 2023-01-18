import * as core from "@actions/core"
import type { AxiosInstance } from "axios"
import axios from "axios"
import moment from "moment"
import { newClient } from "./clients"
import util from "util"

const DEFAULT_CSP_API_URL = "https://console.cloud.vmware.com"

const TOKEN_DETAILS_PATH = "/csp/gateway/am/api/auth/api-tokens/details"

const TOKEN_AUTHORIZE_PATH = "/csp/gateway/am/api/auth/api-tokens/authorize"

const TOKEN_EXPIRATION_DAYS_WARNING = 30

const TOKEN_TIMEOUT = 10 * 60 * 1000 // 10 minutes

interface CspToken {
  access_token: string
  timestamp: number
}

class CSP {
  client: AxiosInstance
  cachedCspToken: CspToken | null = null

  constructor(clientTimeout: number, clientRetryCount: number, clientRetryIntervals: number[]) {
    this.client = newClient(
      {
        baseURL: process.env.CSP_API_URL ? process.env.CSP_API_URL : DEFAULT_CSP_API_URL,
        timeout: clientTimeout,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
      {
        retries: clientRetryCount,
        backoffIntervals: clientRetryIntervals,
      }
    )
  }

  async checkTokenExpiration(): Promise<number> {
    if (!process.env.CSP_API_TOKEN) {
      throw new Error("CSP_API_TOKEN secret not found.")
    }

    const response = await this.client.post(
      TOKEN_DETAILS_PATH,
      { tokenValue: process.env.CSP_API_TOKEN },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )

    const now = moment()
    const expiresAt = moment(response.data.expiresAt)
    const expiresInDays = expiresAt.diff(now, "days")
    if (expiresInDays < TOKEN_EXPIRATION_DAYS_WARNING) {
      core.warning(`CSP API token will expire in ${expiresInDays} days.`)
    } else {
      core.debug(`Checked expiration token, expires ${expiresAt.from(now)}.`)
    }

    if (response.data.details) {
      return response.data.expiresAt
    }

    return response.data.expiresAt
  }

  async getToken(timeout?: number): Promise<string> {
    if (!process.env.CSP_API_TOKEN) {
      throw new Error("CSP_API_TOKEN secret not found.")
    }

    if (this.cachedCspToken != null && this.cachedCspToken.timestamp > Date.now()) {
      return this.cachedCspToken.access_token
    }

    try {
      const response = await this.client.post(
        TOKEN_AUTHORIZE_PATH,
        `grant_type=refresh_token&api_token=${process.env.CSP_API_TOKEN}`
      )

      //TODO: Handle response codes
      core.debug(`Got response from CSP API token ${util.inspect(response.data)}`)
      if (!response.data || !response.data.access_token) {
        throw new Error("Could not fetch access token, got empty response from CSP.")
      }

      this.setCachedToken({
        access_token: response.data.access_token,
        timestamp: Date.now() + (timeout || TOKEN_TIMEOUT),
      })

      core.debug("CSP API token obtained successfully.")
      return response.data.access_token
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 404 || error.response.status === 400) {
          core.debug(util.inspect(error.response.data))
          throw new Error(`Could not obtain CSP API token. Status code: ${error.response.status}.`)
        }
      }
      throw error
    }
  }

  setCachedToken(token: CspToken | null): void {
    this.cachedCspToken = token
  }
}

export default CSP
