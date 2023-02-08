// eslint-disable-next-line filenames/match-regex
import * as core from "@actions/core"
import MockAdapter from "axios-mock-adapter"
import CSP from "../../../src/client/csp"

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
    cspClient = new CSP(120000, 3, [500, 1000, 2000])
    clientStub = new MockAdapter(cspClient.client)
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
