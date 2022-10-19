import * as constants from "./constants"
import * as core from "@actions/core"
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios"
import dns, { LookupAddress } from "dns"
import { ClientConfig } from "./client-config"
import URL from "url"
import net from "net"
import util from "util"

export function newClient(axiosCfg: AxiosRequestConfig, clientCfg: ClientConfig): AxiosInstance {
  const instance = axios.create(axiosCfg)

  instance.interceptors.request.use(async reqConfig => {
    try {
      let url
      if (reqConfig.baseURL) {
        url = URL.parse(reqConfig.baseURL)
      } else if (reqConfig.url) {
        url = URL.parse(reqConfig.url)
      }
      reqConfig["metadata"] = { startTime: new Date() }

      if (net.isIP(url.hostname)) return reqConfig // skip

      if (reqConfig.headers) {
        reqConfig.headers.host = url.hostname
      }

      url.hostname = await getAddress(url.hostname)
      delete url.host // clear hostname

      if (reqConfig.baseURL) {
        reqConfig.baseURL = URL.format(url)
      } else {
        reqConfig.url = URL.format(url)
      }
    } catch (err) {
      core.debug(`Error resolving IP address. Error: ${JSON.stringify(err)}`)
    }

    return reqConfig
  })

  // Resolves a hostname and returns an address. No caching yet.
  async function getAddress(host): Promise<LookupAddress> {
    const ips = await resolveHost(host)
    core.debug(`Resolved IPs for ${host}: ${ips}`)
    const ip = ips[Math.floor(Math.random() * ips.length)] // random
    core.debug(`Using IP: ${ip}`)
    return ip
  }

  const dnsResolve = util.promisify(dns.resolve)
  const dnsLookup = util.promisify(dns.lookup)

  async function resolveHost(host): Promise<LookupAddress[]> {
    let ips
    try {
      ips = await dnsResolve(host)
      throw new Error(`Could not resolve hostname ${host}`)
    } catch (e) {
      let lookupResp = await dnsLookup(host, { all: true }) // pass options all: true for all addresses
      lookupResp = extractAddresses(lookupResp)
      if (!Array.isArray(lookupResp) || lookupResp.length < 1)
        throw new Error(`fallback to dnsLookup returned no address ${host}`)
      ips = lookupResp
    }
    return ips
  }

  function extractAddresses(lookupResp): LookupAddress[] {
    if (!Array.isArray(lookupResp)) throw new Error("lookup response did not contain array of addresses")
    return lookupResp.filter(e => e.address != null).map(e => e.address)
  }

  // Axios error-retry handler
  instance.interceptors.response.use(undefined, async (err: AxiosError) => {
    const config = err.config
    const response = err.response
    const maxRetries = clientCfg.retries ? clientCfg.retries : constants.HTTP_RETRY_COUNT
    const backoffIntervals = clientCfg.backoffIntervals ? clientCfg.backoffIntervals : constants.HTTP_RETRY_INTERVALS

    core.debug(
      `Error: ${JSON.stringify(err)}. Status: ${response ? response.status : "unknown"}. Data: ${
        response ? JSON.stringify(response.data) : "unknown"
      }`
    )
    if (
      (response && response.status && Object.values(constants.RetriableHttpStatus).includes(response.status)) ||
      err.code === "ECONNABORTED" ||
      err.code === "ECONNREFUSED" ||
      err.message === "Network Error"
    ) {
      // Not sure if this message is trustable or just something moxios made up

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
        core.info(`Request to ${config.url} failed. Retry: ${currentState.retryCount}. Waiting ${delay}`)
        currentState.retryCount += 1
      }
      config.transformRequest = [data => data]

      return new Promise(resolve => setTimeout(() => resolve(instance(config)), delay))
    } else {
      return Promise.reject(err)
    }
  })

  return instance
}
