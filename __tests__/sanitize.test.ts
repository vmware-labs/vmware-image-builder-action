// eslint-disable-next-line filenames/match-regex
import { sanitize } from "../src/sanitize"

describe("Sanitize", () => {
  it("Gets a container URI and generates a valid filename with underscores", async () => {
    const sanitized = sanitize(
      "docker.io/bitnami/mariadb:10.5.13-debian-10-r0",
      "_"
    )
    expect(sanitized).toEqual("docker.io_bitnami_mariadb_10.5.13-debian-10-r0")
  })

  it("Gets a container URI and generates a valid filename with dashes", async () => {
    const sanitized = sanitize(
      "docker.io/bitnami/mariadb:10.5.13-debian-10-r0",
      "-"
    )
    expect(sanitized).toEqual("docker.io-bitnami-mariadb-10.5.13-debian-10-r0")
  })
})
