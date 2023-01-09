// eslint-disable-next-line filenames/match-regex
import * as core from "@actions/core"
import MockAdapter from "axios-mock-adapter"
import CSP from "../../src/client/csp"

describe("Given a CSP client", () => {
  let cspClient: CSP
  let clientStub: MockAdapter

  beforeAll(async () => {
    jest.spyOn(core, "info").mockImplementation(msg => console.log("::info:: " + msg))
    jest.spyOn(core, "warning").mockImplementation(msg => console.log("::warning:: " + msg))
    jest.spyOn(core, "debug").mockImplementation(msg => console.log("::debug:: " + msg))
    jest.spyOn(core, "setFailed")
  })

  beforeEach(async () => {
    // Mock a token so it is not a requirement when running tests
    process.env["CSP_API_TOKEN"] = "foo"
    cspClient = new CSP()
    clientStub = new MockAdapter(cspClient.client)
  })

  it("CSP client does a regular request then succeeds", async () => {
    const expectedToken = "h72827dd"

    // no retries exercising on this one yet. Just making sure all is good and there won't be noise.

    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        `{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "${expectedToken}","refresh_token": "aT4epjdh"}`
      )

    const apiToken = await cspClient.getToken(10000)

    expect(apiToken).toEqual(expectedToken)
  })

  it("CSP client does a regular request then fails", async () => {
    // no retries exercising on this one yet. Just making sure all is good and there won't be noise.

    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        404,
        '{"metadata": "knull","traceId": "abc71b186e364bc4","statusCode": 404,"message": "invalid_grant: Invalid refresh token: xxxx...tN3NK","requestId": "0105e0f320064337","moduleCode": "540", "cspErrorCode": "540.120-340.800"}'
      )

    await expect(cspClient.getToken(1000)).rejects.toThrow(
      new Error("Could not obtain CSP API token. Status code: 404.")
    )
    expect(core.setFailed).toHaveBeenCalledTimes(0)
  })

  it("CSP client times out, retries and then fails", async () => {
    // time it out!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").timeout()

    await expect(cspClient.getToken(10000)).rejects.toThrow(new Error("Could not execute operation. Retried 3 times."))
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("CSP client has a network error, retries and then fails", async () => {
    // network error!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").networkError()

    await expect(cspClient.getToken(10000)).rejects.toThrow(new Error("Could not execute operation. Retried 3 times."))
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("CSP client times out, retries and then recovers", async () => {
    // time it out!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").timeoutOnce() // only timeout once

    // Not sure if this can be done better with axios-mock-adapter. Request will timeout once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(cspClient.getToken(10000)).rejects.toThrow(
      new Error("Could not obtain CSP API token. Status code: 404.")
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("CSP client has a network error, retries and then recovers", async () => {
    // network error!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").networkErrorOnce() // Only once, recovers

    // Not sure if this can be done better with axios-mock-adapter. Request will error once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(cspClient.getToken(10000)).rejects.toThrow(
      new Error("Could not obtain CSP API token. Status code: 404.")
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("CSP client retries for retriable codes", async () => {
    // time it out!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").reply(503, { error: "some-error-back" })
    await expect(cspClient.getToken(10000)).rejects.toThrow(new Error("Could not execute operation. Retried 3 times."))
  })

  it("CSP client does not retry for non retriable", async () => {
    // time it out!

    clientStub.onPost("/csp/gateway/am/api/auth/api-tokens/authorize").reply(400, { error: "some-error-back" })
    await expect(cspClient.getToken(10000)).rejects.toThrow(
      new Error("Could not obtain CSP API token. Status code: 400.")
    )
  })

  it("CSP token gets cached", async () => {
    const expectedToken = "h72827dd"
    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        `{"id_token": "aToken","token_type": "bearer","expires_in": 1000,"scope": "*","access_token": "${expectedToken}","refresh_token": "aT4epjdh"}`
      )
    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        `{"id_token": "aToken","token_type": "bearer","expires_in": 1000,"scope": "*","access_token": "token2","refresh_token": "aT4epjdh"}`
      )

    const apiToken = await cspClient.getToken()
    expect(apiToken).toEqual(expectedToken)
    // Call again and our action should use the cached CSP token
    const apiToken2 = await cspClient.getToken()
    expect(apiToken2).toEqual(apiToken)
  })

  it("CSP token to be refreshed", async () => {
    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        `{"id_token": "aToken","token_type": "bearer","expires_in": 1000,"scope": "*","access_token": "token1","refresh_token": "aT4epjdh"}`
      )
    clientStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        `{"id_token": "aToken","token_type": "bearer","expires_in": 1000,"scope": "*","access_token": "token2","refresh_token": "aT4epjdh"}`
      )

    const apiToken = await cspClient.getToken(1) // token will expire after 1ms
    expect(apiToken).toBeDefined()

    await new Promise(resolve => setTimeout(resolve, 10))

    // earlier token should have expired
    const apiToken2 = await cspClient.getToken()
    expect(apiToken2).not.toEqual(apiToken)
  })

  it("No CSP_API_TOKEN throws an error", async () => {
    delete process.env["CSP_API_TOKEN"]
    await expect(cspClient.getToken()).rejects.toThrow(Error("CSP_API_TOKEN secret not found."))
  })

  it("No CSP_API_TOKEN throws an error when checking expiration date", async () => {
    delete process.env["CSP_API_TOKEN"]
    await expect(cspClient.checkTokenExpiration()).rejects.toThrow(Error("CSP_API_TOKEN secret not found."))
  })
})
